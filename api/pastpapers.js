// api/pastpapers.js
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
        "SELECT * FROM pastpapers ORDER BY year DESC, created_at DESC",
      );
      return res.status(200).json(result.rows);
    } else if (method === "POST") {
      const { month, year, title, paper, markscheme } = req.body;
      if (!month || !year || !title) {
        return res
          .status(400)
          .json({ error: "Month, year, and title are required" });
      }

      const result = await pool.query(
        "INSERT INTO pastpapers (month, year, title, paper, markscheme, created_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *",
        [month, year, title, paper || null, markscheme || null],
      );
      return res.status(201).json(result.rows[0]);
    } else if (method === "PUT") {
      const { id, month, year, title, paper, markscheme } = req.body;
      if (!id || !month || !year || !title) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const result = await pool.query(
        "UPDATE pastpapers SET month = $1, year = $2, title = $3, paper = $4, markscheme = $5 WHERE id = $6 RETURNING *",
        [month, year, title, paper || null, markscheme || null, id],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Pastpaper not found" });
      }
      return res.status(200).json(result.rows[0]);
    } else if (method === "DELETE") {
      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ error: "Pastpaper ID is required" });
      }

      const result = await pool.query(
        "DELETE FROM pastpapers WHERE id = $1 RETURNING *",
        [id],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Pastpaper not found" });
      }
      return res
        .status(200)
        .json({ message: "Pastpaper deleted successfully" });
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
