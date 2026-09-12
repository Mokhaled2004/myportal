const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = async (req, res) => {
  const { method } = req;

  try {
    if (method === "GET") {
      const result = await pool.query(`
        SELECT id, title, url, TO_CHAR(meeting_date, 'YYYY-MM-DD') AS meeting_date, hours, created_at
        FROM meetings
        ORDER BY meeting_date ASC, created_at ASC
      `);
      return res.status(200).json(result.rows);
    } else if (method === "POST") {
      const { title, url, meeting_date, hours } = req.body;
      if (!title || !url || !meeting_date || !hours) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const result = await pool.query(
        `INSERT INTO meetings (title, url, meeting_date, hours, created_at) 
         VALUES ($1, $2, $3, $4, NOW()) 
         RETURNING id, title, url, TO_CHAR(meeting_date, 'YYYY-MM-DD') AS meeting_date, hours, created_at`,
        [title, url, meeting_date, hours],
      );

      return res.status(201).json(result.rows[0]);
    } else if (method === "PUT") {
      const { id, title, url, meeting_date, hours } = req.body;
      if (!id || !title || !url || !meeting_date || !hours) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const result = await pool.query(
        `UPDATE meetings 
         SET title = $1, url = $2, meeting_date = $3, hours = $4 
         WHERE id = $5 
         RETURNING id, title, url, TO_CHAR(meeting_date, 'YYYY-MM-DD') AS meeting_date, hours, created_at`,
        [title, url, meeting_date, hours, id],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Meeting not found" });
      }

      return res.status(200).json(result.rows[0]);
    } else if (method === "DELETE") {
      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ error: "Meeting ID is required" });
      }

      const result = await pool.query(
        "DELETE FROM meetings WHERE id = $1 RETURNING *",
        [id],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Meeting not found" });
      }

      return res.status(200).json({ message: "Meeting deleted successfully" });
    } else {
      res.setHeader("Allow", ["GET", "POST", "PUT", "DELETE"]);
      return res.status(405).json({ error: `Method ${method} not allowed` });
    }
  } catch (err) {
    console.error("Database error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
