// api/admin-dashboard.js
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = async (req, res) => {
  const { method } = req;

  try {
    if (method === "GET") {
      // Fetch course details, core stats, and extended database table row counts
      const courseRes = await pool.query(
        `SELECT course_name, course_code, next_final_exam_date FROM courses LIMIT 1;`,
      );

      const statsRes = await pool.query(`
        SELECT 
          (SELECT COUNT(*) FROM users WHERE is_admin = false AND is_assistant = false) AS total_students,
          (SELECT COUNT(*) FROM exams) AS total_exams,
          (SELECT COUNT(*) FROM homeworks) AS total_homeworks,
          (SELECT COUNT(*) FROM attendance_sessions) AS total_sessions,
          (SELECT COUNT(*) FROM pastpapers) AS total_pastpapers,
          (SELECT COUNT(*) FROM files) AS total_files,
          (SELECT COUNT(*) FROM chapters) AS total_chapters,
          (SELECT COUNT(*) FROM videos) AS total_videos,
          (SELECT COUNT(*) FROM announcements) AS total_announcements,
          (SELECT COUNT(*) FROM meetings) AS total_meetings;
      `);

      // Top 3 students based on overall average percentage
      const topStudentsRes = await pool.query(`
        SELECT 
          u.id, 
          u.full_name, 
          u.school_name,
          ROUND(COALESCE(AVG((sg.numeric_grade / NULLIF(e.total_grade, 0)) * 100), 0), 1) AS avg_score
        FROM users u
        LEFT JOIN student_grades sg ON u.id = sg.student_id
        LEFT JOIN exams e ON sg.exam_id = e.id
        WHERE u.is_admin = false AND u.is_assistant = false
        GROUP BY u.id, u.full_name, u.school_name
        ORDER BY avg_score DESC
        LIMIT 3;
      `);

      // At-risk students calculated using the exact same grade formula and criteria
      const atRiskRes = await pool.query(`
        WITH student_metrics AS (
          SELECT 
            u.id, 
            u.full_name, 
            u.school_name,
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
        ORDER BY avg_score ASC;
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
    }

    if (method === "PUT") {
      // Modify course details
      const { course_name, course_code, next_final_exam_date } = req.body;

      const updateQuery = `
        INSERT INTO courses (id, course_name, course_code, next_final_exam_date, updated_at)
        VALUES (1, $1, $2, $3, NOW())
        ON CONFLICT (id) 
        DO UPDATE SET 
          course_name = EXCLUDED.course_name,
          course_code = EXCLUDED.course_code,
          next_final_exam_date = EXCLUDED.next_final_exam_date,
          updated_at = NOW()
        RETURNING *;
      `;
      const values = [course_name, course_code, next_final_exam_date];
      const result = await pool.query(updateQuery, values);

      return res.status(200).json({
        message: "Course updated successfully",
        course: result.rows[0],
      });
    }

    res.setHeader("Allow", ["GET", "PUT"]);
    return res.status(405).json({ error: `Method ${method} not allowed` });
  } catch (err) {
    console.error("Dashboard API error:", err);
    return res
      .status(500)
      .json({ error: err.message || "Internal server error" });
  }
};
