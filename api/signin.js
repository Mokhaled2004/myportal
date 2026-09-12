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

module.exports = async (req, res) => {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { full_name, password } = req.body;
  if (!full_name || !password) {
    return res
      .status(400)
      .json({ success: false, error: "Full name and password are required" });
  }

  try {
    const query = `SELECT * FROM users WHERE full_name = $1;`;
    const result = await pool.query(query, [full_name]);

    if (result.rows.length === 0) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid credentials" });
    }

    const user = result.rows[0];
    const isValid = verifyPassword(password, user.password);

    if (!isValid) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid credentials" });
    }

    const { password: _, ...userWithoutPassword } = user;
    return res.status(200).json({ success: true, user: userWithoutPassword });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, error: "Database query error" });
  }
};
