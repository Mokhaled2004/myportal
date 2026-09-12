// api/student-progress.js
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = async (req, res) => {
  const { method } = req;
  const { student_id } = req.query;

  try {
    if (method === "GET") {
      if (student_id) {
        // Fetch student details
        const studentQuery = `SELECT id, full_name, school_name FROM users WHERE id = $1 AND is_admin = false AND is_assistant = false;`;
        const studentRes = await pool.query(studentQuery, [student_id]);

        if (studentRes.rows.length === 0) {
          return res.status(404).json({ error: "Student not found" });
        }

        // Fetch attendance breakdown
        const attendanceQuery = `
          SELECT 
            s.id AS session_id, 
            s.date, 
            s.title AS session_title, 
            COALESCE(sa.status, 'absent') AS status
          FROM attendance_sessions s
          LEFT JOIN student_attendance sa ON s.id = sa.session_id AND sa.student_id = $1
          ORDER BY s.date DESC;
        `;
        const attendanceRes = await pool.query(attendanceQuery, [student_id]);

        // Fetch homeworks breakdown
        const homeworksQuery = `
          SELECT 
            h.id AS homework_id, 
            h.title AS homework_title, 
            h.deadline,
            COALESCE(sh.status, 'missing') AS status,
            sh.admin_comment
          FROM homeworks h
          LEFT JOIN student_homeworks sh ON h.id = sh.homework_id AND sh.user_id = $1
          ORDER BY h.deadline DESC;
        `;
        const homeworksRes = await pool.query(homeworksQuery, [student_id]);

        // Fetch exams breakdown ordered by creation order / insertion sequence (or exam_date + id) so chronological progress is accurate
        const examsQuery = `
          SELECT 
            e.id AS exam_id, 
            e.title AS exam_title, 
            e.type, 
            e.total_grade,
            e.exam_date,
            sg.numeric_grade,
            sg.letter_grade,
            sg.comment
          FROM exams e
          LEFT JOIN student_grades sg ON e.id = sg.exam_id AND sg.student_id = $1
          ORDER BY e.created_at ASC, e.id ASC;
        `;
        const examsRes = await pool.query(examsQuery, [student_id]);

        // Fetch pastpapers breakdown
        const pastpapersQuery = `
          SELECT 
            p.id AS pastpaper_id, 
            p.title AS pastpaper_title, 
            p.year, 
            p.month,
            COALESCE(sp.status, 'missing') AS status
          FROM pastpapers p
          LEFT JOIN student_pastpapers sp ON p.id = sp.pastpaper_id AND sp.user_id = $1
          ORDER BY p.year DESC, p.created_at DESC;
        `;
        const pastpapersRes = await pool.query(pastpapersQuery, [student_id]);

        return res.status(200).json({
          student: studentRes.rows[0],
          attendance: attendanceRes.rows,
          homeworks: homeworksRes.rows,
          exams: examsRes.rows,
          pastpapers: pastpapersRes.rows,
        });
      }

      // Otherwise, return summary list of all students
      const query = `
        SELECT 
          u.id AS user_id,
          u.full_name,
          u.school_name,
          (SELECT COUNT(*) FROM attendance_sessions) AS total_sessions,
          (SELECT COUNT(*) FROM student_attendance sa JOIN attendance_sessions s ON sa.session_id = s.id WHERE sa.student_id = u.id AND sa.status = 'present') AS present_sessions,
          (SELECT COUNT(*) FROM homeworks) AS total_homeworks,
          (SELECT COUNT(*) FROM student_homeworks sh WHERE sh.user_id = u.id AND sh.status = 'submitted') AS submitted_homeworks,
          (SELECT COUNT(*) FROM exams) AS total_exams,
          (SELECT COUNT(*) FROM student_grades sg WHERE sg.student_id = u.id AND sg.numeric_grade IS NOT NULL) AS graded_exams,
          (SELECT COUNT(*) FROM pastpapers) AS total_pastpapers,
          (SELECT COUNT(*) FROM student_pastpapers sp WHERE sp.user_id = u.id AND sp.status = 'submitted') AS submitted_pastpapers
        FROM users u
        WHERE u.is_admin = false AND u.is_assistant = false
        ORDER BY u.full_name ASC;
      `;
      const result = await pool.query(query);
      return res.status(200).json(result.rows);
    } else {
      res.setHeader("Allow", ["GET"]);
      return res.status(405).json({ error: `Method ${method} not allowed` });
    }
  } catch (err) {
    console.error("Database error:", err);
    return res
      .status(500)
      .json({ error: err.message || "Internal server error" });
  }
};
