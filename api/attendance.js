// api/attendance.js
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = async (req, res) => {
  const { method } = req;
  const { action, studentId, sessionId, id } = req.query;

  try {
    // 1. Get attendance records for a specific student (Student Portal view)
    if (method === "GET" && studentId) {
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

    // 2. Get all attendance sessions (Admin view or fallback for students viewing general lists if needed)
    if (method === "GET" && !action && !studentId) {
      const result = await pool.query(
        "SELECT * FROM attendance_sessions ORDER BY date DESC, created_at DESC",
      );
      return res.status(200).json(result.rows);
    }

    // 3. Get students and their attendance status for a specific session
    else if (method === "GET" && action === "session_details") {
      if (!sessionId) {
        return res.status(400).json({ error: "Session ID is required" });
      }

      // Fetch only users who are students (where is_admin and is_assistant are false/null)
      const studentsQuery = await pool.query(
        "SELECT id, full_name, school_name FROM users WHERE (is_admin = false OR is_admin IS NULL) AND (is_assistant = false OR is_assistant IS NULL) ORDER BY full_name ASC",
      );

      // Fetch existing attendance marks for this session
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

    // 4. Create a new attendance session
    else if (method === "POST" && !action) {
      const { date, title } = req.body;
      if (!date) {
        return res.status(400).json({ error: "Date is required" });
      }

      const result = await pool.query(
        "INSERT INTO attendance_sessions (date, title, created_at) VALUES ($1, $2, NOW()) RETURNING *",
        [date, title || null],
      );
      return res.status(201).json(result.rows[0]);
    }

    // 5. Mark / Update attendance for students in a session (Bulk Upsert)
    else if (method === "POST" && action === "mark") {
      const { sessionId, records } = req.body;
      if (!sessionId || !Array.isArray(records)) {
        return res
          .status(400)
          .json({ error: "Session ID and records array are required" });
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
        return res
          .status(200)
          .json({ message: "Attendance saved successfully" });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }

    // 6. Delete an attendance session
    else if (method === "DELETE") {
      const sessionIdToDelete = id || req.query.sessionId;
      if (!sessionIdToDelete) {
        return res.status(400).json({ error: "Session ID is required" });
      }

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
    } else {
      res.setHeader("Allow", ["GET", "POST", "DELETE"]);
      return res.status(405).json({ error: `Method ${method} not allowed` });
    }
  } catch (err) {
    console.error("Database error:", err);
    return res
      .status(500)
      .json({ error: err.message || "Internal server error" });
  }
};
