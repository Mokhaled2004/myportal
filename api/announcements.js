// api/announcements.js
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
        "SELECT * FROM announcements ORDER BY created_at DESC",
      );
      return res.status(200).json(result.rows);
    } else if (method === "POST") {
      const { title, description, priority } = req.body;
      if (!title || !description) {
        return res
          .status(400)
          .json({ error: "Title and description are required" });
      }

      const result = await pool.query(
        "INSERT INTO announcements (title, description, priority, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *",
        [title, description, priority || "normal"],
      );
      return res.status(201).json(result.rows[0]);
    } else if (method === "PUT") {
      const { id, title, description, priority } = req.body;
      if (!id || !title || !description) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const result = await pool.query(
        "UPDATE announcements SET title = $1, description = $2, priority = $3 WHERE id = $4 RETURNING *",
        [title, description, priority || "normal", id],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Announcement not found" });
      }
      return res.status(200).json(result.rows[0]);
    } else if (method === "DELETE") {
      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ error: "Announcement ID is required" });
      }

      const result = await pool.query(
        "DELETE FROM announcements WHERE id = $1 RETURNING *",
        [id],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Announcement not found" });
      }
      return res
        .status(200)
        .json({ message: "Announcement deleted successfully" });
    } else {
      res.setHeader("Allow", ["GET", "POST", "PUT", "DELETE"]);
      return res.status(405).json({ error: `Method ${method} not allowed` });
    }
  } catch (err) {
    console.error("Database error:", err);
    return res
      .status(500)
      .json({ error: err.message || "Internal server error" });
  }
};
