const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const handler = async (req, res) => {
  const { method } = req;

  try {
    if (method === "GET") {
      const filesResult = await pool.query(
        "SELECT id, title, description, file_path, created_at FROM files ORDER BY created_at DESC",
      );

      const files = filesResult.rows;

      for (let file of files) {
        const chaptersResult = await pool.query(
          `SELECT c.id, c.title FROM chapters c
           JOIN file_chapters fc ON c.id = fc.chapter_id
           WHERE fc.file_id = $1`,
          [file.id],
        );
        file.chapters = chaptersResult.rows;
      }

      return res.status(200).json(files);
    }

    if (method === "POST" || method === "PUT") {
      const id = method === "PUT" ? req.body.id : null;
      const { title, description, file_path, chapter_ids } = req.body;

      if (!title) {
        return res.status(400).json({ error: "File title is required" });
      }

      if (!file_path) {
        return res.status(400).json({ error: "File link URL is required" });
      }

      let chapterIdsParsed = [];
      try {
        chapterIdsParsed = Array.isArray(chapter_ids)
          ? chapter_ids
          : chapter_ids
            ? JSON.parse(chapter_ids)
            : [];
      } catch (e) {
        chapterIdsParsed = [];
      }

      let client = await pool.connect();
      try {
        await client.query("BEGIN");

        let fileResult;
        if (method === "POST") {
          const insertQuery = `
            INSERT INTO files (title, description, file_path, created_at)
            VALUES ($1, $2, $3, NOW()) RETURNING *
          `;
          fileResult = await client.query(insertQuery, [
            title,
            description || "",
            file_path,
          ]);
        } else {
          const updateQuery = `
            UPDATE files SET title = $1, description = $2, file_path = $3
            WHERE id = $4 RETURNING *
          `;
          fileResult = await client.query(updateQuery, [
            title,
            description || "",
            file_path,
            id,
          ]);

          if (fileResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "File not found" });
          }
        }

        const fileId = fileResult.rows[0].id;

        await client.query("DELETE FROM file_chapters WHERE file_id = $1", [
          fileId,
        ]);
        for (const chapId of chapterIdsParsed) {
          await client.query(
            "INSERT INTO file_chapters (file_id, chapter_id) VALUES ($1, $2)",
            [fileId, chapId],
          );
        }

        await client.query("COMMIT");
        return res
          .status(method === "POST" ? 201 : 200)
          .json(fileResult.rows[0]);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } else if (method === "DELETE") {
      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ error: "File ID is required" });
      }

      const result = await pool.query(
        "DELETE FROM files WHERE id = $1 RETURNING *",
        [id],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "File not found" });
      }

      return res.status(200).json({ message: "File deleted successfully" });
    } else {
      res.setHeader("Allow", ["GET", "POST", "PUT", "DELETE"]);
      return res.status(405).json({ error: `Method ${method} not allowed` });
    }
  } catch (err) {
    console.error("Database error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = handler;
