// api/pastpaper-submissions.js
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = async (req, res) => {
  const { method } = req;
  const { pastpaper_id, action } = req.query;

  try {
    if (method === "GET") {
      // If pastpaper_id is provided, return all students and their submission status for that pastpaper
      if (pastpaper_id) {
        const query = `
          SELECT 
            u.id AS user_id, 
            u.full_name, 
            u.school_name, 
            COALESCE(sp.status, 'missing') AS status,
            sp.updated_at
          FROM users u
          LEFT JOIN student_pastpapers sp ON u.id = sp.user_id AND sp.pastpaper_id = $1
          WHERE u.is_admin = false AND u.is_assistant = false
          ORDER BY u.full_name ASC;
        `;
        const result = await pool.query(query, [pastpaper_id]);
        return res.status(200).json(result.rows);
      }

      // Otherwise, return all pastpapers
      const result = await pool.query(
        "SELECT * FROM pastpapers ORDER BY year DESC, created_at DESC",
      );
      return res.status(200).json(result.rows);
    } else if (method === "PUT") {
      // Update pastpaper active status and deadline
      const { id, is_active, deadline } = req.body;
      if (!id) {
        return res.status(400).json({ error: "Pastpaper ID is required" });
      }

      const result = await pool.query(
        "UPDATE pastpapers SET is_active = $1, deadline = $2 WHERE id = $3 RETURNING *",
        [is_active ?? false, deadline || null, id],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Pastpaper not found" });
      }
      return res.status(200).json(result.rows[0]);
    } else if (method === "POST") {
      // Update or insert individual student submission status
      const { pastpaper_id, user_id, status } = req.body;
      if (!pastpaper_id || !user_id || !status) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const query = `
        INSERT INTO student_pastpapers (pastpaper_id, user_id, status, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (pastpaper_id, user_id)
        DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
        RETURNING *;
      `;
      const result = await pool.query(query, [pastpaper_id, user_id, status]);
      return res.status(200).json(result.rows[0]);
    } else {
      res.setHeader("Allow", ["GET", "PUT", "POST"]);
      return res.status(405).json({ error: `Method ${method} not allowed` });
    }
  } catch (err) {
    console.error("Database error:", err);
    return res
      .status(500)
      .json({ error: err.message || "Internal server error" });
  }
};
