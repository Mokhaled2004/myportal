// api/schools.js
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = async (req, res) => {
  const { method } = req;
  const { id } = req.query;

  try {
    // 1. Get all schools
    if (method === "GET") {
      const result = await pool.query("SELECT * FROM schools ORDER BY id DESC");
      return res.status(200).json(result.rows);
    }

    // 2. Create a new school
    else if (method === "POST") {
      const { school_name } = req.body;
      if (!school_name || !school_name.trim()) {
        return res.status(400).json({ error: "School name is required" });
      }

      const result = await pool.query(
        "INSERT INTO schools (school_name, created_at) VALUES ($1, NOW()) RETURNING *",
        [school_name.trim()],
      );
      return res.status(201).json(result.rows[0]);
    }

    // 3. Delete a school
    else if (method === "DELETE") {
      const schoolIdToDelete = id || req.query.schoolId;
      if (!schoolIdToDelete) {
        return res.status(400).json({ error: "School ID is required" });
      }

      const result = await pool.query(
        "DELETE FROM schools WHERE id = $1 RETURNING *",
        [schoolIdToDelete],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "School not found" });
      }
      return res.status(200).json({ message: "School deleted successfully" });
    } else {
      res.setHeader("Allow", ["GET", "POST", "DELETE"]);
      return res.status(405).json({ error: `Method ${method} not allowed` });
    }
  } catch (err) {
    console.error("Database error:", err);
    if (err.code === "23505") {
      return res.status(400).json({ error: "School name already exists" });
    }
    return res
      .status(500)
      .json({ error: err.message || "Internal server error" });
  }
};
