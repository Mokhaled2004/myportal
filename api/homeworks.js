// api/homeworks.js
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = async (req, res) => {
  const { method } = req;

  try {
    if (method === "GET") {
      const { user_id } = req.query;

      // Fetch all homeworks with chapter info, instructions, and attachment_url
      const homeworksRes = await pool.query(`
        SELECT 
          h.id, 
          h.title, 
          h.instructions,
          h.attachment_url,
          h.deadline, 
          h.created_at,
          h.chapter_id,
          c.title as chapter_title
        FROM homeworks h
        LEFT JOIN chapters c ON h.chapter_id = c.id
        ORDER BY h.deadline ASC
      `);

      // Fetch all users (students) without referencing any email column
      const usersRes = await pool.query(`
        SELECT id, full_name, school_name, is_admin FROM users ORDER BY full_name ASC
      `);

      // Fetch all student homework statuses and comments
      const statusesRes = await pool.query(`
        SELECT homework_id, user_id, status, admin_comment FROM student_homeworks
      `);

      const students = usersRes.rows.filter((u) => !u.is_admin);

      const homeworks = homeworksRes.rows.map((hw) => {
        const hwStatuses = statusesRes.rows.filter(
          (s) => s.homework_id === hw.id,
        );
        const studentStatuses = students.map((student) => {
          const found = hwStatuses.find((s) => s.user_id === student.id);
          return {
            user_id: student.id,
            full_name: student.full_name,
            school_name: student.school_name,
            status: found ? found.status : "not_submitted",
            admin_comment: found ? found.admin_comment : null,
          };
        });

        let userStatus = "not_submitted";
        let userComment = null;
        if (user_id) {
          const foundUserStatus = hwStatuses.find((s) => s.user_id == user_id);
          if (foundUserStatus) {
            userStatus = foundUserStatus.status;
            userComment = foundUserStatus.admin_comment;
          }
        }

        return {
          ...hw,
          status: userStatus,
          admin_comment: userComment,
          students: studentStatuses,
        };
      });

      if (user_id !== undefined) {
        return res.status(200).json(homeworks);
      }

      return res.status(200).json({ homeworks, students });
    } else if (method === "POST") {
      const { title, instructions, attachment_url, chapter_id, deadline } =
        req.body;
      if (!title || !deadline) {
        return res
          .status(400)
          .json({ error: "Title and deadline are required" });
      }

      const result = await pool.query(
        "INSERT INTO homeworks (title, instructions, attachment_url, chapter_id, deadline, created_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *",
        [
          title,
          instructions || null,
          attachment_url || null,
          chapter_id || null,
          deadline,
        ],
      );

      return res.status(201).json(result.rows[0]);
    } else if (method === "PUT") {
      const { action } = req.query;

      if (action === "update-status") {
        const { homework_id, user_id, status } = req.body;
        if (!homework_id || !user_id || !status) {
          return res.status(400).json({ error: "Missing required fields" });
        }

        await pool.query(
          `
          INSERT INTO student_homeworks (homework_id, user_id, status, updated_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (homework_id, user_id)
          DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
        `,
          [homework_id, user_id, status],
        );

        return res.status(200).json({ message: "Status updated successfully" });
      } else if (action === "update-comment") {
        const { homework_id, user_id, admin_comment } = req.body;
        if (!homework_id || !user_id) {
          return res.status(400).json({ error: "Missing required fields" });
        }

        await pool.query(
          `
          INSERT INTO student_homeworks (homework_id, user_id, admin_comment, updated_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (homework_id, user_id)
          DO UPDATE SET admin_comment = EXCLUDED.admin_comment, updated_at = NOW()
        `,
          [homework_id, user_id, admin_comment || null],
        );

        return res
          .status(200)
          .json({ message: "Comment updated successfully" });
      } else {
        const {
          id,
          title,
          instructions,
          attachment_url,
          chapter_id,
          deadline,
        } = req.body;
        const result = await pool.query(
          "UPDATE homeworks SET title = $1, instructions = $2, attachment_url = $3, chapter_id = $4, deadline = $5 WHERE id = $6 RETURNING *",
          [
            title,
            instructions || null,
            attachment_url || null,
            chapter_id || null,
            deadline,
            id,
          ],
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ error: "Homework not found" });
        }
        return res.status(200).json(result.rows[0]);
      }
    } else if (method === "DELETE") {
      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ error: "Homework ID is required" });
      }

      await pool.query("DELETE FROM homeworks WHERE id = $1", [id]);
      return res.status(200).json({ message: "Homework deleted successfully" });
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
