/**
 * api/index.js
 *
 * Single Vercel serverless entrypoint for the myportal backend.
 * All routes are consolidated here to stay within the Vercel Hobby plan
 * function limit (12 functions max).
 *
 * Route map (matches existing frontend fetch paths exactly):
 *   POST   /api/signin
 *   POST   /api/signup
 *   POST   /api/update-profile
 *   GET    /api/users
 *   GET    /api/admin-dashboard
 *   PUT    /api/admin-dashboard
 *   GET    /api/chapters
 *   POST   /api/chapters
 *   DELETE /api/chapters
 *   GET    /api/announcements
 *   POST   /api/announcements
 *   PUT    /api/announcements
 *   DELETE /api/announcements
 *   GET    /api/meetings
 *   POST   /api/meetings
 *   PUT    /api/meetings
 *   DELETE /api/meetings
 *   GET    /api/schools
 *   POST   /api/schools
 *   DELETE /api/schools
 *   GET    /api/videos
 *   POST   /api/videos
 *   PUT    /api/videos
 *   DELETE /api/videos
 *   GET    /api/files
 *   POST   /api/files
 *   PUT    /api/files
 *   DELETE /api/files
 *   GET    /api/homeworks
 *   POST   /api/homeworks
 *   PUT    /api/homeworks
 *   DELETE /api/homeworks
 *   GET    /api/exams
 *   POST   /api/exams
 *   PUT    /api/exams
 *   DELETE /api/exams
 *   GET    /api/attendance
 *   POST   /api/attendance
 *   DELETE /api/attendance
 *   GET    /api/pastpapers
 *   POST   /api/pastpapers
 *   PUT    /api/pastpapers
 *   DELETE /api/pastpapers
 *   GET    /api/pastpaper-submissions
 *   POST   /api/pastpaper-submissions
 *   PUT    /api/pastpaper-submissions
 *   GET    /api/student-progress
 */

"use strict";

require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const { Pool } = require("pg");

// ---------------------------------------------------------------------------
// Database – single pool shared across all route handlers
// ---------------------------------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---------------------------------------------------------------------------
// Password helpers (used by /signin, /signup, /update-profile)
// ---------------------------------------------------------------------------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(suppliedPassword, storedHash) {
  if (!suppliedPassword || !storedHash || !storedHash.includes(":")) {
    return false;
  }
  const [salt, key] = storedHash.split(":");
  if (!salt || !key) return false;
  const hashedBuffer = crypto.scryptSync(suppliedPassword, salt, 64);
  const keyBuffer = Buffer.from(key, "hex");
  return crypto.timingSafeEqual(hashedBuffer, keyBuffer);
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS – allow same-origin and any configured client origin
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS",
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const router = express.Router();

// ===========================================================================
// AUTH
// ===========================================================================

// POST /api/signin
router.post("/signin", async (req, res) => {
  const { full_name, password } = req.body;
  if (!full_name || !password) {
    return res
      .status(400)
      .json({ success: false, error: "Full name and password are required" });
  }
  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE full_name = $1",
      [full_name],
    );
    if (result.rows.length === 0) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid credentials" });
    }
    const user = result.rows[0];
    if (!verifyPassword(password, user.password)) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid credentials" });
    }
    const { password: _pw, ...userWithoutPassword } = user;
    return res.status(200).json({ success: true, user: userWithoutPassword });
  } catch (err) {
    console.error("signin error:", err);
    return res
      .status(500)
      .json({ success: false, error: "Database query error" });
  }
});

// POST /api/signup
router.post("/signup", async (req, res) => {
  const { full_name, school_name, password, account_type } = req.body;
  const isAdmin = account_type === "admin";
  try {
    const hashedPassword = hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (full_name, school_name, password, is_admin, is_assistant)
       VALUES ($1, $2, $3, $4, false)
       RETURNING id, full_name, school_name, is_admin, is_assistant`,
      [full_name, school_name, hashedPassword, isAdmin],
    );
    return res.status(201).json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error("signup error:", err);
    return res
      .status(500)
      .json({ success: false, error: "Database insertion error" });
  }
});

// POST|PUT /api/update-profile
router.all("/update-profile", async (req, res) => {
  if (req.method !== "POST" && req.method !== "PUT") {
    return res
      .status(405)
      .json({ success: false, error: "Method not allowed" });
  }
  const userId = req.body.user_id || req.body.admin_id || req.body.id;
  const { full_name, current_password, new_password } = req.body;
  if (!userId || !full_name || !current_password) {
    return res.status(400).json({
      success: false,
      error: "User ID, full name, and current password are required",
    });
  }
  try {
    const userResult = await pool.query(
      "SELECT * FROM users WHERE id = $1",
      [userId],
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "User not found" });
    }
    const user = userResult.rows[0];
    if (!verifyPassword(current_password, user.password)) {
      return res
        .status(401)
        .json({ success: false, error: "Incorrect current password" });
    }
    let passwordToStore = user.password;
    if (new_password && new_password.trim() !== "") {
      passwordToStore = hashPassword(new_password);
    }
    const updateResult = await pool.query(
      `UPDATE users
       SET full_name = $1, password = $2
       WHERE id = $3
       RETURNING id, full_name, school_name, is_admin, is_assistant, created_at`,
      [full_name, passwordToStore, userId],
    );
    return res.status(200).json({ success: true, user: updateResult.rows[0] });
  } catch (err) {
    console.error("update-profile error:", err);
    return res
      .status(500)
      .json({ success: false, error: "Database update error" });
  }
});

// ===========================================================================
// USERS
// ===========================================================================

// GET /api/users
router.get("/users", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, full_name, school_name, is_admin, is_assistant, created_at FROM users ORDER BY created_at DESC",
    );
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("users error:", err);
    return res.status(500).json({ error: "Failed to fetch users" });
  }
});

// ===========================================================================
// ADMIN DASHBOARD
// ===========================================================================

router
  .route("/admin-dashboard")
  .get(async (req, res) => {
    try {
      const courseRes = await pool.query(
        "SELECT course_name, course_code, next_final_exam_date FROM courses LIMIT 1",
      );
      const statsRes = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM users WHERE is_admin = false AND is_assistant = false) AS total_students,
          (SELECT COUNT(*) FROM exams)                  AS total_exams,
          (SELECT COUNT(*) FROM homeworks)              AS total_homeworks,
          (SELECT COUNT(*) FROM attendance_sessions)    AS total_sessions,
          (SELECT COUNT(*) FROM pastpapers)             AS total_pastpapers,
          (SELECT COUNT(*) FROM files)                  AS total_files,
          (SELECT COUNT(*) FROM chapters)               AS total_chapters,
          (SELECT COUNT(*) FROM videos)                 AS total_videos,
          (SELECT COUNT(*) FROM announcements)          AS total_announcements,
          (SELECT COUNT(*) FROM meetings)               AS total_meetings
      `);
      const topStudentsRes = await pool.query(`
        SELECT
          u.id, u.full_name, u.school_name,
          ROUND(COALESCE(AVG((sg.numeric_grade / NULLIF(e.total_grade, 0)) * 100), 0), 1) AS avg_score
        FROM users u
        LEFT JOIN student_grades sg ON u.id = sg.student_id
        LEFT JOIN exams e ON sg.exam_id = e.id
        WHERE u.is_admin = false AND u.is_assistant = false
        GROUP BY u.id, u.full_name, u.school_name
        ORDER BY avg_score DESC
        LIMIT 3
      `);
      const atRiskRes = await pool.query(`
        WITH student_metrics AS (
          SELECT
            u.id, u.full_name, u.school_name,
            ROUND(COALESCE(AVG((sg.numeric_grade / NULLIF(e.total_grade, 0)) * 100), 0), 1) AS avg_score,
            (SELECT COUNT(*) FROM homeworks) AS total_hw,
            (SELECT COUNT(*) FROM student_homeworks sh WHERE sh.user_id = u.id AND sh.status = 'submitted') AS submitted_hw
          FROM users u
          LEFT JOIN student_grades sg ON u.id = sg.student_id
          LEFT JOIN exams e ON sg.exam_id = e.id
          WHERE u.is_admin = false AND u.is_assistant = false
          GROUP BY u.id, u.full_name, u.school_name
        )
        SELECT * FROM student_metrics
        WHERE avg_score < 60 OR (total_hw > 0 AND (CAST(submitted_hw AS FLOAT) / total_hw) < 0.5)
        ORDER BY avg_score ASC
      `);
      return res.status(200).json({
        course: courseRes.rows[0] || {
          course_name: "",
          course_code: "",
          next_final_exam_date: null,
        },
        stats: statsRes.rows[0],
        topStudents: topStudentsRes.rows,
        atRiskStudents: atRiskRes.rows,
      });
    } catch (err) {
      console.error("admin-dashboard GET error:", err);
      return res
        .status(500)
        .json({ error: err.message || "Internal server error" });
    }
  })
  .put(async (req, res) => {
    const { course_name, course_code, next_final_exam_date } = req.body;
    try {
      const result = await pool.query(
        `INSERT INTO courses (id, course_name, course_code, next_final_exam_date, updated_at)
         VALUES (1, $1, $2, $3, NOW())
         ON CONFLICT (id)
         DO UPDATE SET
           course_name          = EXCLUDED.course_name,
           course_code          = EXCLUDED.course_code,
           next_final_exam_date = EXCLUDED.next_final_exam_date,
           updated_at           = NOW()
         RETURNING *`,
        [course_name, course_code, next_final_exam_date],
      );
      return res
        .status(200)
        .json({ message: "Course updated successfully", course: result.rows[0] });
    } catch (err) {
      console.error("admin-dashboard PUT error:", err);
      return res
        .status(500)
        .json({ error: err.message || "Internal server error" });
    }
  });

// ===========================================================================
// CHAPTERS
// ===========================================================================

router
  .route("/chapters")
  .get(async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT id, title, created_at FROM chapters ORDER BY created_at DESC",
      );
      return res.status(200).json(result.rows);
    } catch (err) {
      console.error("chapters GET error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  })
  .post(async (req, res) => {
    const { title } = req.body;
    if (!title) {
      return res.status(400).json({ error: "Chapter title is required" });
    }
    try {
      const result = await pool.query(
        "INSERT INTO chapters (title, created_at) VALUES ($1, NOW()) RETURNING *",
        [title],
      );
      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("chapters POST error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  })
  .delete(async (req, res) => {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: "Chapter ID is required" });
    }
    try {
      const result = await pool.query(
        "DELETE FROM chapters WHERE id = $1 RETURNING *",
        [id],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Chapter not found" });
      }
      return res.status(200).json({ message: "Chapter deleted successfully" });
    } catch (err) {
      console.error("chapters DELETE error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

// ===========================================================================
// ANNOUNCEMENTS
// ===========================================================================

router
  .route("/announcements")
  .get(async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT * FROM announcements ORDER BY created_at DESC",
      );
      return res.status(200).json(result.rows);
    } catch (err) {
      console.error("announcements GET error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  })
  .post(async (req, res) => {
    const { title, description, priority } = req.body;
    if (!title || !description) {
      return res
        .status(400)
        .json({ error: "Title and description are required" });
    }
    try {
      const result = await pool.query(
        "INSERT INTO announcements (title, description, priority, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *",
        [title, description, priority || "normal"],
      );
      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("announcements POST error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  })
  .put(async (req, res) => {
    const { id, title, description, priority } = req.body;
    if (!id || !title || !description) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    try {
      const result = await pool.query(
        "UPDATE announcements SET title = $1, description = $2, priority = $3 WHERE id = $4 RETURNING *",
        [title, description, priority || "normal", id],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Announcement not found" });
      }
      return res.status(200).json(result.rows[0]);
    } catch (err) {
      console.error("announcements PUT error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  })
  .delete(async (req, res) => {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: "Announcement ID is required" });
    }
    try {
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
    } catch (err) {
      console.error("announcements DELETE error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

// ===========================================================================
// MEETINGS
// ===========================================================================

router
  .route("/meetings")
  .get(async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT id, title, url,
               TO_CHAR(meeting_date, 'YYYY-MM-DD') AS meeting_date,
               hours, created_at
        FROM meetings
        ORDER BY meeting_date ASC, created_at ASC
      `);
      return res.status(200).json(result.rows);
    } catch (err) {
      console.error("meetings GET error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  })
  .post(async (req, res) => {
    const { title, url, meeting_date, hours } = req.body;
    if (!title || !url || !meeting_date || !hours) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    try {
      const result = await pool.query(
        `INSERT INTO meetings (title, url, meeting_date, hours, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING id, title, url, TO_CHAR(meeting_date, 'YYYY-MM-DD') AS meeting_date, hours, created_at`,
        [title, url, meeting_date, hours],
      );
      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("meetings POST error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  })
  .put(async (req, res) => {
    const { id, title, url, meeting_date, hours } = req.body;
    if (!id || !title || !url || !meeting_date || !hours) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    try {
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
    } catch (err) {
      console.error("meetings PUT error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  })
  .delete(async (req, res) => {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: "Meeting ID is required" });
    }
    try {
      const result = await pool.query(
        "DELETE FROM meetings WHERE id = $1 RETURNING *",
        [id],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Meeting not found" });
      }
      return res.status(200).json({ message: "Meeting deleted successfully" });
    } catch (err) {
      console.error("meetings DELETE error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

// ===========================================================================
// SCHOOLS
// ===========================================================================

router
  .route("/schools")
  .get(async (req, res) => {
    try {
      const result = await pool.query("SELECT * FROM schools ORDER BY id DESC");
      return res.status(200).json(result.rows);
    } catch (err) {
      console.error("schools GET error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  })
  .post(async (req, res) => {
    const { school_name } = req.body;
    if (!school_name || !school_name.trim()) {
      return res.status(400).json({ error: "School name is required" });
    }
    try {
      const result = await pool.query(
        "INSERT INTO schools (school_name, created_at) VALUES ($1, NOW()) RETURNING *",
        [school_name.trim()],
      );
      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("schools POST error:", err);
      if (err.code === "23505") {
        return res.status(400).json({ error: "School name already exists" });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  })
  .delete(async (req, res) => {
    const schoolId = req.query.id || req.query.schoolId;
    if (!schoolId) {
      return res.status(400).json({ error: "School ID is required" });
    }
    try {
      const result = await pool.query(
        "DELETE FROM schools WHERE id = $1 RETURNING *",
        [schoolId],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "School not found" });
      }
      return res.status(200).json({ message: "School deleted successfully" });
    } catch (err) {
      console.error("schools DELETE error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

// ===========================================================================
// VIDEOS
// ===========================================================================

/** Shared helper to fetch a video with its chapters by id. */
async function fetchVideoWithChapters(client, videoId) {
  return client.query(
    `SELECT
       v.id, v.title, v.url, v.created_at,
       COALESCE(
         json_agg(json_build_object('id', c.id, 'title', c.title))
         FILTER (WHERE c.id IS NOT NULL), '[]'
       ) AS chapters
     FROM videos v
     LEFT JOIN video_chapters vc ON v.id = vc.video_id
     LEFT JOIN chapters c ON vc.chapter_id = c.id
     WHERE v.id = $1
     GROUP BY v.id`,
    [videoId],
  );
}

router
  .route("/videos")
  .get(async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          v.id, v.title, v.url, v.created_at,
          COALESCE(
            json_agg(json_build_object('id', c.id, 'title', c.title))
            FILTER (WHERE c.id IS NOT NULL), '[]'
          ) AS chapters
        FROM videos v
        LEFT JOIN video_chapters vc ON v.id = vc.video_id
        LEFT JOIN chapters c ON vc.chapter_id = c.id
        GROUP BY v.id
        ORDER BY v.created_at DESC
      `);
      return res.status(200).json(result.rows);
    } catch (err) {
      console.error("videos GET error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  })
  .post(async (req, res) => {
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
      const newVideoId = videoRes.rows[0].id;
      if (chapter_ids && chapter_ids.length > 0) {
        for (const chId of chapter_ids) {
          await client.query(
            "INSERT INTO video_chapters (video_id, chapter_id) VALUES ($1, $2)",
            [newVideoId, chId],
          );
        }
      }
      await client.query("COMMIT");
      const fullRes = await fetchVideoWithChapters(pool, newVideoId);
      return res.status(201).json(fullRes.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("videos POST error:", err);
      return res.status(500).json({ error: "Internal server error" });
    } finally {
      client.release();
    }
  })
  .put(async (req, res) => {
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
      await client.query("DELETE FROM video_chapters WHERE video_id = $1", [id]);
      if (chapter_ids && chapter_ids.length > 0) {
        for (const chId of chapter_ids) {
          await client.query(
            "INSERT INTO video_chapters (video_id, chapter_id) VALUES ($1, $2)",
            [id, chId],
          );
        }
      }
      await client.query("COMMIT");
      const fullRes = await fetchVideoWithChapters(pool, id);
      return res.status(200).json(fullRes.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("videos PUT error:", err);
      return res.status(500).json({ error: "Internal server error" });
    } finally {
      client.release();
    }
  })
  .delete(async (req, res) => {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: "Video ID is required" });
    }
    try {
      const result = await pool.query(
        "DELETE FROM videos WHERE id = $1 RETURNING *",
        [id],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Video not found" });
      }
      return res.status(200).json({ message: "Video deleted successfully" });
    } catch (err) {
      console.error("videos DELETE error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

// ===========================================================================
// FILES
// ===========================================================================

router
  .route("/files")
  .get(async (req, res) => {
    try {
      const filesResult = await pool.query(
        "SELECT id, title, description, file_path, created_at FROM files ORDER BY created_at DESC",
      );
      const files = filesResult.rows;
      for (const file of files) {
        const chaptersResult = await pool.query(
          `SELECT c.id, c.title FROM chapters c
           JOIN file_chapters fc ON c.id = fc.chapter_id
           WHERE fc.file_id = $1`,
          [file.id],
        );
        file.chapters = chaptersResult.rows;
      }
      return res.status(200).json(files);
    } catch (err) {
      console.error("files GET error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  })
  .post(async (req, res) => {
    const { title, description, file_path, chapter_ids } = req.body;
    if (!title) return res.status(400).json({ error: "File title is required" });
    if (!file_path) return res.status(400).json({ error: "File link URL is required" });
    let chapterIdsParsed = [];
    try {
      chapterIdsParsed = Array.isArray(chapter_ids)
        ? chapter_ids
        : chapter_ids
          ? JSON.parse(chapter_ids)
          : [];
    } catch (_) {
      chapterIdsParsed = [];
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const fileResult = await client.query(
        "INSERT INTO files (title, description, file_path, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *",
        [title, description || "", file_path],
      );
      const fileId = fileResult.rows[0].id;
      for (const chapId of chapterIdsParsed) {
        await client.query(
          "INSERT INTO file_chapters (file_id, chapter_id) VALUES ($1, $2)",
          [fileId, chapId],
        );
      }
      await client.query("COMMIT");
      return res.status(201).json(fileResult.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("files POST error:", err);
      return res.status(500).json({ error: "Internal server error" });
    } finally {
      client.release();
    }
  })
  .put(async (req, res) => {
    const { id, title, description, file_path, chapter_ids } = req.body;
    if (!title) return res.status(400).json({ error: "File title is required" });
    if (!file_path) return res.status(400).json({ error: "File link URL is required" });
    let chapterIdsParsed = [];
    try {
      chapterIdsParsed = Array.isArray(chapter_ids)
        ? chapter_ids
        : chapter_ids
          ? JSON.parse(chapter_ids)
          : [];
    } catch (_) {
      chapterIdsParsed = [];
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const fileResult = await client.query(
        "UPDATE files SET title = $1, description = $2, file_path = $3 WHERE id = $4 RETURNING *",
        [title, description || "", file_path, id],
      );
      if (fileResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "File not found" });
      }
      const fileId = fileResult.rows[0].id;
      await client.query("DELETE FROM file_chapters WHERE file_id = $1", [fileId]);
      for (const chapId of chapterIdsParsed) {
        await client.query(
          "INSERT INTO file_chapters (file_id, chapter_id) VALUES ($1, $2)",
          [fileId, chapId],
        );
      }
      await client.query("COMMIT");
      return res.status(200).json(fileResult.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("files PUT error:", err);
      return res.status(500).json({ error: "Internal server error" });
    } finally {
      client.release();
    }
  })
  .delete(async (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "File ID is required" });
    try {
      const result = await pool.query(
        "DELETE FROM files WHERE id = $1 RETURNING *",
        [id],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "File not found" });
      }
      return res.status(200).json({ message: "File deleted successfully" });
    } catch (err) {
      console.error("files DELETE error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

// ===========================================================================
// HOMEWORKS
// ===========================================================================

router
  .route("/homeworks")
  .get(async (req, res) => {
    const { user_id } = req.query;
    try {
      const homeworksRes = await pool.query(`
        SELECT
          h.id, h.title, h.instructions, h.attachment_url,
          h.deadline, h.created_at, h.chapter_id, c.title AS chapter_title
        FROM homeworks h
        LEFT JOIN chapters c ON h.chapter_id = c.id
        ORDER BY h.deadline ASC
      `);
      const usersRes = await pool.query(
        "SELECT id, full_name, school_name, is_admin FROM users ORDER BY full_name ASC",
      );
      const statusesRes = await pool.query(
        "SELECT homework_id, user_id, status, admin_comment FROM student_homeworks",
      );
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
        return { ...hw, status: userStatus, admin_comment: userComment, students: studentStatuses };
      });

      if (user_id !== undefined) return res.status(200).json(homeworks);
      return res.status(200).json({ homeworks, students });
    } catch (err) {
      console.error("homeworks GET error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  })
  .post(async (req, res) => {
    const { title, instructions, attachment_url, chapter_id, deadline } = req.body;
    if (!title || !deadline) {
      return res.status(400).json({ error: "Title and deadline are required" });
    }
    try {
      const result = await pool.query(
        "INSERT INTO homeworks (title, instructions, attachment_url, chapter_id, deadline, created_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *",
        [title, instructions || null, attachment_url || null, chapter_id || null, deadline],
      );
      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("homeworks POST error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  })
  .put(async (req, res) => {
    const { action } = req.query;
    try {
      if (action === "update-status") {
        const { homework_id, user_id, status } = req.body;
        if (!homework_id || !user_id || !status) {
          return res.status(400).json({ error: "Missing required fields" });
        }
        await pool.query(
          `INSERT INTO student_homeworks (homework_id, user_id, status, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (homework_id, user_id)
           DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`,
          [homework_id, user_id, status],
        );
        return res.status(200).json({ message: "Status updated successfully" });
      } else if (action === "update-comment") {
        const { homework_id, user_id, admin_comment } = req.body;
        if (!homework_id || !user_id) {
          return res.status(400).json({ error: "Missing required fields" });
        }
        await pool.query(
          `INSERT INTO student_homeworks (homework_id, user_id, admin_comment, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (homework_id, user_id)
           DO UPDATE SET admin_comment = EXCLUDED.admin_comment, updated_at = NOW()`,
          [homework_id, user_id, admin_comment || null],
        );
        return res.status(200).json({ message: "Comment updated successfully" });
      } else {
        const { id, title, instructions, attachment_url, chapter_id, deadline } = req.body;
        const result = await pool.query(
          "UPDATE homeworks SET title = $1, instructions = $2, attachment_url = $3, chapter_id = $4, deadline = $5 WHERE id = $6 RETURNING *",
          [title, instructions || null, attachment_url || null, chapter_id || null, deadline, id],
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ error: "Homework not found" });
        }
        return res.status(200).json(result.rows[0]);
      }
    } catch (err) {
      console.error("homeworks PUT error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  })
  .delete(async (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "Homework ID is required" });
    try {
      await pool.query("DELETE FROM homeworks WHERE id = $1", [id]);
      return res.status(200).json({ message: "Homework deleted successfully" });
    } catch (err) {
      console.error("homeworks DELETE error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  });

// ===========================================================================
// EXAMS
// ===========================================================================

router
  .route("/exams")
  .get(async (req, res) => {
    const { user_id } = req.query;
    try {
      const examsRes = await pool.query(`
        SELECT id, title, type, total_grade,
               TO_CHAR(exam_date, 'YYYY-MM-DD') AS exam_date,
               exam_time, duration_minutes, created_at
        FROM exams ORDER BY created_at DESC
      `);
      const chaptersRes = await pool.query(
        "SELECT id, title FROM chapters ORDER BY title ASC",
      );
      const examChaptersRes = await pool.query(
        "SELECT exam_id, chapter_id FROM exam_chapters",
      );
      const usersRes = await pool.query(
        "SELECT id, full_name, school_name, is_admin FROM users ORDER BY full_name ASC",
      );
      const thresholdsRes = await pool.query(
        "SELECT id, exam_id, grade_letter, min_score FROM exam_grade_thresholds ORDER BY min_score DESC",
      );
      const gradesRes = await pool.query(
        "SELECT id, exam_id, student_id, numeric_grade, letter_grade, comment, updated_at FROM student_grades",
      );
      const students = usersRes.rows.filter((u) => !u.is_admin);

      const exams = examsRes.rows.map((exam) => {
        const examThresholds = thresholdsRes.rows.filter((t) => t.exam_id === exam.id);
        const examGrades = gradesRes.rows.filter((g) => g.exam_id === exam.id);
        const assignedChapterIds = examChaptersRes.rows
          .filter((ec) => ec.exam_id === exam.id)
          .map((ec) => ec.chapter_id);
        const examChapters = chaptersRes.rows.filter((c) =>
          assignedChapterIds.includes(c.id),
        );
        const studentGradesList = students.map((student) => {
          const found = examGrades.find((g) => g.student_id === student.id);
          return {
            user_id: student.id,
            full_name: student.full_name,
            school_name: student.school_name,
            numeric_grade: found ? found.numeric_grade : null,
            letter_grade: found ? found.letter_grade : null,
            comment: found ? found.comment : null,
          };
        });
        let userGradeData = null;
        if (user_id) {
          const foundUserGrade = examGrades.find((g) => g.student_id == user_id);
          if (foundUserGrade) userGradeData = foundUserGrade;
        }
        return {
          ...exam,
          chapters: examChapters,
          chapter_ids: assignedChapterIds,
          thresholds: examThresholds,
          user_grade: userGradeData,
          students: studentGradesList,
        };
      });

      if (user_id !== undefined) return res.status(200).json(exams);
      return res.status(200).json({ exams, students, chapters: chaptersRes.rows });
    } catch (err) {
      console.error("exams GET error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  })
  .post(async (req, res) => {
    const { title, type, total_grade, exam_date, exam_time, duration_minutes, thresholds, chapter_ids } = req.body;
    if (!title || !type || total_grade === undefined) {
      return res.status(400).json({ error: "Title, type, and total_grade are required" });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const examResult = await client.query(
        `INSERT INTO exams (title, type, total_grade, exam_date, exam_time, duration_minutes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING id, title, type, total_grade, TO_CHAR(exam_date, 'YYYY-MM-DD') AS exam_date,
                   exam_time, duration_minutes, created_at`,
        [title, type, total_grade, exam_date || null, exam_time || null, duration_minutes || null],
      );
      const examId = examResult.rows[0].id;
      if (thresholds && Array.isArray(thresholds)) {
        for (const t of thresholds) {
          await client.query(
            "INSERT INTO exam_grade_thresholds (exam_id, grade_letter, min_score) VALUES ($1, $2, $3)",
            [examId, t.grade_letter, t.min_score],
          );
        }
      }
      if (chapter_ids && Array.isArray(chapter_ids)) {
        for (const chId of chapter_ids) {
          await client.query(
            "INSERT INTO exam_chapters (exam_id, chapter_id) VALUES ($1, $2)",
            [examId, chId],
          );
        }
      }
      await client.query("COMMIT");
      return res.status(201).json(examResult.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("exams POST error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    } finally {
      client.release();
    }
  })
  .put(async (req, res) => {
    const { action } = req.query;
    try {
      if (action === "update-grade") {
        const { exam_id, student_id, numeric_grade, comment } = req.body;
        if (!exam_id || !student_id) {
          return res.status(400).json({ error: "Missing required fields" });
        }
        const threshRes = await pool.query(
          "SELECT grade_letter, min_score FROM exam_grade_thresholds WHERE exam_id = $1 ORDER BY min_score DESC",
          [exam_id],
        );
        let letter_grade = "F";
        if (numeric_grade !== null && numeric_grade !== undefined && !isNaN(numeric_grade)) {
          const scoreNum = parseFloat(numeric_grade);
          for (const t of threshRes.rows) {
            if (scoreNum >= parseFloat(t.min_score)) {
              letter_grade = t.grade_letter;
              break;
            }
          }
        } else {
          letter_grade = null;
        }
        await pool.query(
          `INSERT INTO student_grades (exam_id, student_id, numeric_grade, letter_grade, comment, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (exam_id, student_id)
           DO UPDATE SET
             numeric_grade = EXCLUDED.numeric_grade,
             letter_grade  = EXCLUDED.letter_grade,
             comment       = EXCLUDED.comment,
             updated_at    = NOW()`,
          [
            exam_id,
            student_id,
            numeric_grade !== "" && numeric_grade !== undefined ? numeric_grade : null,
            letter_grade,
            comment || null,
          ],
        );
        return res.status(200).json({ message: "Grade saved successfully", letter_grade });
      } else {
        const { id, title, type, total_grade, exam_date, exam_time, duration_minutes, thresholds, chapter_ids } = req.body;
        if (!id || !title || !type || total_grade === undefined) {
          return res.status(400).json({ error: "Missing required fields" });
        }
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const updateRes = await client.query(
            `UPDATE exams
             SET title = $1, type = $2, total_grade = $3, exam_date = $4, exam_time = $5, duration_minutes = $6
             WHERE id = $7
             RETURNING id, title, type, total_grade, TO_CHAR(exam_date, 'YYYY-MM-DD') AS exam_date,
                       exam_time, duration_minutes, created_at`,
            [title, type, total_grade, exam_date || null, exam_time || null, duration_minutes || null, id],
          );
          if (updateRes.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Exam not found" });
          }
          if (thresholds && Array.isArray(thresholds)) {
            await client.query("DELETE FROM exam_grade_thresholds WHERE exam_id = $1", [id]);
            for (const t of thresholds) {
              await client.query(
                "INSERT INTO exam_grade_thresholds (exam_id, grade_letter, min_score) VALUES ($1, $2, $3)",
                [id, t.grade_letter, t.min_score],
              );
            }
          }
          if (chapter_ids && Array.isArray(chapter_ids)) {
            await client.query("DELETE FROM exam_chapters WHERE exam_id = $1", [id]);
            for (const chId of chapter_ids) {
              await client.query(
                "INSERT INTO exam_chapters (exam_id, chapter_id) VALUES ($1, $2)",
                [id, chId],
              );
            }
          }
          await client.query("COMMIT");
          return res.status(200).json(updateRes.rows[0]);
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      }
    } catch (err) {
      console.error("exams PUT error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  })
  .delete(async (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "Exam ID is required" });
    try {
      await pool.query("DELETE FROM exams WHERE id = $1", [id]);
      return res.status(200).json({ message: "Exam deleted successfully" });
    } catch (err) {
      console.error("exams DELETE error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  });

// ===========================================================================
// ATTENDANCE
// ===========================================================================

router
  .route("/attendance")
  .get(async (req, res) => {
    const { action, studentId, sessionId } = req.query;
    try {
      // Student's own attendance records
      if (studentId) {
        const result = await pool.query(
          `SELECT sa.id, s.title, s.date, sa.status, sa.updated_at
           FROM student_attendance sa
           JOIN attendance_sessions s ON sa.session_id = s.id
           WHERE sa.student_id = $1
           ORDER BY s.date DESC, s.id DESC`,
          [studentId],
        );
        return res.status(200).json(result.rows);
      }
      // Session details – students with their status
      if (action === "session_details") {
        if (!sessionId) return res.status(400).json({ error: "Session ID is required" });
        const studentsQuery = await pool.query(
          `SELECT id, full_name, school_name FROM users
           WHERE (is_admin = false OR is_admin IS NULL)
             AND (is_assistant = false OR is_assistant IS NULL)
           ORDER BY full_name ASC`,
        );
        const attendanceQuery = await pool.query(
          "SELECT student_id, status FROM student_attendance WHERE session_id = $1",
          [sessionId],
        );
        const attendanceMap = {};
        attendanceQuery.rows.forEach((row) => {
          attendanceMap[row.student_id] = row.status;
        });
        const studentsWithAttendance = studentsQuery.rows.map((student) => ({
          ...student,
          status: attendanceMap[student.id] || "absent",
        }));
        return res.status(200).json(studentsWithAttendance);
      }
      // All sessions list
      const result = await pool.query(
        "SELECT * FROM attendance_sessions ORDER BY date DESC, created_at DESC",
      );
      return res.status(200).json(result.rows);
    } catch (err) {
      console.error("attendance GET error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  })
  .post(async (req, res) => {
    const { action } = req.query;
    try {
      if (action === "mark") {
        const { sessionId, records } = req.body;
        if (!sessionId || !Array.isArray(records)) {
          return res.status(400).json({ error: "Session ID and records array are required" });
        }
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          for (const record of records) {
            await client.query(
              `INSERT INTO student_attendance (session_id, student_id, status, updated_at)
               VALUES ($1, $2, $3, NOW())
               ON CONFLICT (session_id, student_id)
               DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`,
              [sessionId, record.studentId, record.status],
            );
          }
          await client.query("COMMIT");
          return res.status(200).json({ message: "Attendance saved successfully" });
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      } else {
        // Create new session
        const { date, title } = req.body;
        if (!date) return res.status(400).json({ error: "Date is required" });
        const result = await pool.query(
          "INSERT INTO attendance_sessions (date, title, created_at) VALUES ($1, $2, NOW()) RETURNING *",
          [date, title || null],
        );
        return res.status(201).json(result.rows[0]);
      }
    } catch (err) {
      console.error("attendance POST error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  })
  .delete(async (req, res) => {
    const sessionIdToDelete = req.query.id || req.query.sessionId;
    if (!sessionIdToDelete) {
      return res.status(400).json({ error: "Session ID is required" });
    }
    try {
      const result = await pool.query(
        "DELETE FROM attendance_sessions WHERE id = $1 RETURNING *",
        [sessionIdToDelete],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Session not found" });
      }
      return res
        .status(200)
        .json({ message: "Attendance session deleted successfully" });
    } catch (err) {
      console.error("attendance DELETE error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  });

// ===========================================================================
// PAST PAPERS
// ===========================================================================

router
  .route("/pastpapers")
  .get(async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT * FROM pastpapers ORDER BY year DESC, created_at DESC",
      );
      return res.status(200).json(result.rows);
    } catch (err) {
      console.error("pastpapers GET error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  })
  .post(async (req, res) => {
    const { month, year, title, paper, markscheme } = req.body;
    if (!month || !year || !title) {
      return res.status(400).json({ error: "Month, year, and title are required" });
    }
    try {
      const result = await pool.query(
        "INSERT INTO pastpapers (month, year, title, paper, markscheme, created_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *",
        [month, year, title, paper || null, markscheme || null],
      );
      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("pastpapers POST error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  })
  .put(async (req, res) => {
    const { id, month, year, title, paper, markscheme } = req.body;
    if (!id || !month || !year || !title) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    try {
      const result = await pool.query(
        "UPDATE pastpapers SET month = $1, year = $2, title = $3, paper = $4, markscheme = $5 WHERE id = $6 RETURNING *",
        [month, year, title, paper || null, markscheme || null, id],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Pastpaper not found" });
      }
      return res.status(200).json(result.rows[0]);
    } catch (err) {
      console.error("pastpapers PUT error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  })
  .delete(async (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "Pastpaper ID is required" });
    try {
      const result = await pool.query(
        "DELETE FROM pastpapers WHERE id = $1 RETURNING *",
        [id],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Pastpaper not found" });
      }
      return res.status(200).json({ message: "Pastpaper deleted successfully" });
    } catch (err) {
      console.error("pastpapers DELETE error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  });

// ===========================================================================
// PAST PAPER SUBMISSIONS
// ===========================================================================

router
  .route("/pastpaper-submissions")
  .get(async (req, res) => {
    const { pastpaper_id } = req.query;
    try {
      if (pastpaper_id) {
        const result = await pool.query(
          `SELECT
             u.id AS user_id, u.full_name, u.school_name,
             COALESCE(sp.status, 'missing') AS status,
             sp.updated_at
           FROM users u
           LEFT JOIN student_pastpapers sp
             ON u.id = sp.user_id AND sp.pastpaper_id = $1
           WHERE u.is_admin = false AND u.is_assistant = false
           ORDER BY u.full_name ASC`,
          [pastpaper_id],
        );
        return res.status(200).json(result.rows);
      }
      const result = await pool.query(
        "SELECT * FROM pastpapers ORDER BY year DESC, created_at DESC",
      );
      return res.status(200).json(result.rows);
    } catch (err) {
      console.error("pastpaper-submissions GET error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  })
  .post(async (req, res) => {
    const { pastpaper_id, user_id, status } = req.body;
    if (!pastpaper_id || !user_id || !status) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    try {
      const result = await pool.query(
        `INSERT INTO student_pastpapers (pastpaper_id, user_id, status, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (pastpaper_id, user_id)
         DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()
         RETURNING *`,
        [pastpaper_id, user_id, status],
      );
      return res.status(200).json(result.rows[0]);
    } catch (err) {
      console.error("pastpaper-submissions POST error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  })
  .put(async (req, res) => {
    const { id, is_active, deadline } = req.body;
    if (!id) return res.status(400).json({ error: "Pastpaper ID is required" });
    try {
      const result = await pool.query(
        "UPDATE pastpapers SET is_active = $1, deadline = $2 WHERE id = $3 RETURNING *",
        [is_active ?? false, deadline || null, id],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Pastpaper not found" });
      }
      return res.status(200).json(result.rows[0]);
    } catch (err) {
      console.error("pastpaper-submissions PUT error:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  });

// ===========================================================================
// STUDENT PROGRESS
// ===========================================================================

router.get("/student-progress", async (req, res) => {
  const { student_id } = req.query;
  try {
    if (student_id) {
      const studentRes = await pool.query(
        "SELECT id, full_name, school_name FROM users WHERE id = $1 AND is_admin = false AND is_assistant = false",
        [student_id],
      );
      if (studentRes.rows.length === 0) {
        return res.status(404).json({ error: "Student not found" });
      }
      const attendanceRes = await pool.query(
        `SELECT
           s.id AS session_id, s.date, s.title AS session_title,
           COALESCE(sa.status, 'absent') AS status
         FROM attendance_sessions s
         LEFT JOIN student_attendance sa ON s.id = sa.session_id AND sa.student_id = $1
         ORDER BY s.date DESC`,
        [student_id],
      );
      const homeworksRes = await pool.query(
        `SELECT
           h.id AS homework_id, h.title AS homework_title, h.deadline,
           COALESCE(sh.status, 'missing') AS status, sh.admin_comment
         FROM homeworks h
         LEFT JOIN student_homeworks sh ON h.id = sh.homework_id AND sh.user_id = $1
         ORDER BY h.deadline DESC`,
        [student_id],
      );
      const examsRes = await pool.query(
        `SELECT
           e.id AS exam_id, e.title AS exam_title, e.type, e.total_grade, e.exam_date,
           sg.numeric_grade, sg.letter_grade, sg.comment
         FROM exams e
         LEFT JOIN student_grades sg ON e.id = sg.exam_id AND sg.student_id = $1
         ORDER BY e.created_at ASC, e.id ASC`,
        [student_id],
      );
      const pastpapersRes = await pool.query(
        `SELECT
           p.id AS pastpaper_id, p.title AS pastpaper_title, p.year, p.month,
           COALESCE(sp.status, 'missing') AS status
         FROM pastpapers p
         LEFT JOIN student_pastpapers sp ON p.id = sp.pastpaper_id AND sp.user_id = $1
         ORDER BY p.year DESC, p.created_at DESC`,
        [student_id],
      );
      return res.status(200).json({
        student: studentRes.rows[0],
        attendance: attendanceRes.rows,
        homeworks: homeworksRes.rows,
        exams: examsRes.rows,
        pastpapers: pastpapersRes.rows,
      });
    }

    // Summary list of all students
    const result = await pool.query(`
      SELECT
        u.id AS user_id, u.full_name, u.school_name,
        (SELECT COUNT(*) FROM attendance_sessions) AS total_sessions,
        (SELECT COUNT(*) FROM student_attendance sa JOIN attendance_sessions s ON sa.session_id = s.id
         WHERE sa.student_id = u.id AND sa.status = 'present') AS present_sessions,
        (SELECT COUNT(*) FROM homeworks) AS total_homeworks,
        (SELECT COUNT(*) FROM student_homeworks sh WHERE sh.user_id = u.id AND sh.status = 'submitted') AS submitted_homeworks,
        (SELECT COUNT(*) FROM exams) AS total_exams,
        (SELECT COUNT(*) FROM student_grades sg WHERE sg.student_id = u.id AND sg.numeric_grade IS NOT NULL) AS graded_exams,
        (SELECT COUNT(*) FROM pastpapers) AS total_pastpapers,
        (SELECT COUNT(*) FROM student_pastpapers sp WHERE sp.user_id = u.id AND sp.status = 'submitted') AS submitted_pastpapers
      FROM users u
      WHERE u.is_admin = false AND u.is_assistant = false
      ORDER BY u.full_name ASC
    `);
    return res.status(200).json(result.rows);
  } catch (err) {
    console.error("student-progress GET error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ===========================================================================
// Mount router and export
// ===========================================================================

app.use("/api", router);

// 404 catch-all for unmatched /api/* paths
app.use("/api/*", (req, res) => {
  res.status(404).json({ error: "API route not found" });
});

module.exports = app;
