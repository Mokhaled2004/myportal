// update-profile.js
const { Pool } = require("pg");
const crypto = require("crypto");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function verifyPassword(suppliedPassword, storedHash) {
  if (!suppliedPassword || !storedHash || !storedHash.includes(":")) {
    return false;
  }
  const [salt, key] = storedHash.split(":");
  if (!salt || !key) return false;

  const hashedBuffer = crypto.scryptSync(suppliedPassword, salt, 64);
  const keyBuffer = Buffer.from(key, "hex");
  return crypto.timingSafeEqual(hashedBuffer, keyBuffer);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST" && req.method !== "PUT") {
    return res
      .status(405)
      .json({ success: false, error: "Method not allowed" });
  }

  // Support user_id, admin_id, or id from request body
  const userId = req.body.user_id || req.body.admin_id || req.body.id;
  const { full_name, current_password, new_password } = req.body;

  if (!userId || !full_name || !current_password) {
    return res.status(400).json({
      success: false,
      error: "User ID, full name, and current password are required",
    });
  }

  try {
    const userQuery = `SELECT * FROM users WHERE id = $1;`;
    const userResult = await pool.query(userQuery, [userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const user = userResult.rows[0];

    const isValid = verifyPassword(current_password, user.password);
    if (!isValid) {
      return res
        .status(401)
        .json({ success: false, error: "Incorrect current password" });
    }

    let passwordToStore = user.password;
    if (new_password && new_password.trim() !== "") {
      passwordToStore = hashPassword(new_password);
    }

    const updateQuery = `
      UPDATE users
      SET full_name = $1, password = $2
      WHERE id = $3
      RETURNING id, full_name, school_name, is_admin, is_assistant, created_at;
    `;
    const updateResult = await pool.query(updateQuery, [
      full_name,
      passwordToStore,
      userId,
    ]);

    return res.status(200).json({
      success: true,
      user: updateResult.rows[0],
    });
  } catch (err) {
    console.error("Database update error:", err);
    return res
      .status(500)
      .json({ success: false, error: "Database update error" });
  }
};
