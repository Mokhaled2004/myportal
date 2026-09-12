const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = async (req, res) => {
  const { method } = req;

  try {
    if (method === "GET") {
      const result = await pool.query(
        "SELECT id, title, created_at FROM chapters ORDER BY created_at DESC",
      );
      return res.status(200).json(result.rows);
    } else if (method === "POST") {
      const { title } = req.body;
      if (!title) {
        return res.status(400).json({ error: "Chapter title is required" });
      }

      const result = await pool.query(
        "INSERT INTO chapters (title, created_at) VALUES ($1, NOW()) RETURNING *",
        [title],
      );
      return res.status(201).json(result.rows[0]);
    } else if (method === "DELETE") {
      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ error: "Chapter ID is required" });
      }

      const result = await pool.query(
        "DELETE FROM chapters WHERE id = $1 RETURNING *",
        [id],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Chapter not found" });
      }

      return res.status(200).json({ message: "Chapter deleted successfully" });
    } else {
      res.setHeader("Allow", ["GET", "POST", "DELETE"]);
      return res.status(405).json({ error: `Method ${method} not allowed` });
    }
  } catch (err) {
    console.error("Database error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
