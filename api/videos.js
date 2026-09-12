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
        SELECT 
          v.id, 
          v.title, 
          v.url, 
          v.created_at,
          COALESCE(
            json_agg(
              json_build_object('id', c.id, 'title', c.title)
            ) FILTER (WHERE c.id IS NOT NULL), '[]'
          ) as chapters
        FROM videos v
        LEFT JOIN video_chapters vc ON v.id = vc.video_id
        LEFT JOIN chapters c ON vc.chapter_id = c.id
        GROUP BY v.id
        ORDER BY v.created_at DESC
      `);
      return res.status(200).json(result.rows);
    } else if (method === "POST") {
      const { title, url, chapter_ids } = req.body;
      if (!title || !url) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const videoRes = await client.query(
          "INSERT INTO videos (title, url, created_at) VALUES ($1, $2, NOW()) RETURNING *",
          [title, url],
        );
        const newVideo = videoRes.rows[0];

        if (chapter_ids && chapter_ids.length > 0) {
          for (const chId of chapter_ids) {
            await client.query(
              "INSERT INTO video_chapters (video_id, chapter_id) VALUES ($1, $2)",
              [newVideo.id, chId],
            );
          }
        }
        await client.query("COMMIT");

        // Fetch complete video with chapters
        const fullRes = await pool.query(
          `
          SELECT 
            v.id, 
            v.title, 
            v.url, 
            v.created_at,
            COALESCE(
              json_agg(
                json_build_object('id', c.id, 'title', c.title)
              ) FILTER (WHERE c.id IS NOT NULL), '[]'
            ) as chapters
          FROM videos v
          LEFT JOIN video_chapters vc ON v.id = vc.video_id
          LEFT JOIN chapters c ON vc.chapter_id = c.id
          WHERE v.id = $1
          GROUP BY v.id
        `,
          [newVideo.id],
        );

        return res.status(201).json(fullRes.rows[0]);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    } else if (method === "PUT") {
      const { id, title, url, chapter_ids } = req.body;
      if (!id || !title || !url) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const videoRes = await client.query(
          "UPDATE videos SET title = $1, url = $2 WHERE id = $3 RETURNING *",
          [title, url, id],
        );

        if (videoRes.rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Video not found" });
        }

        // Update chapters relation
        await client.query("DELETE FROM video_chapters WHERE video_id = $1", [
          id,
        ]);
        if (chapter_ids && chapter_ids.length > 0) {
          for (const chId of chapter_ids) {
            await client.query(
              "INSERT INTO video_chapters (video_id, chapter_id) VALUES ($1, $2)",
              [id, chId],
            );
          }
        }
        await client.query("COMMIT");

        const fullRes = await pool.query(
          `
          SELECT 
            v.id, 
            v.title, 
            v.url, 
            v.created_at,
            COALESCE(
              json_agg(
                json_build_object('id', c.id, 'title', c.title)
              ) FILTER (WHERE c.id IS NOT NULL), '[]'
            ) as chapters
          FROM videos v
          LEFT JOIN video_chapters vc ON v.id = vc.video_id
          LEFT JOIN chapters c ON vc.chapter_id = c.id
          WHERE v.id = $1
          GROUP BY v.id
        `,
          [id],
        );

        return res.status(200).json(fullRes.rows[0]);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    } else if (method === "DELETE") {
      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ error: "Video ID is required" });
      }

      const result = await pool.query(
        "DELETE FROM videos WHERE id = $1 RETURNING *",
        [id],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Video not found" });
      }

      return res.status(200).json({ message: "Video deleted successfully" });
    } else {
      res.setHeader("Allow", ["GET", "POST", "PUT", "DELETE"]);
      return res.status(405).json({ error: `Method ${method} not allowed` });
    }
  } catch (err) {
    console.error("Database error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
