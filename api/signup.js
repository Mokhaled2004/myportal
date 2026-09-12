const { Pool } = require("pg");
const crypto = require("crypto");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { full_name, school_name, password, account_type } = req.body;
  const isAdmin = account_type === "admin";

  try {
    const hashedPassword = hashPassword(password);
    const query = `
      INSERT INTO users (full_name, school_name, password, is_admin, is_assistant)
      VALUES ($1, $2, $3, $4, false)
      RETURNING id, full_name, school_name, is_admin, is_assistant;
    `;
    const result = await pool.query(query, [
      full_name,
      school_name,
      hashedPassword,
      isAdmin,
    ]);
    return res.status(201).json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ success: false, error: "Database insertion error" });
  }
};
