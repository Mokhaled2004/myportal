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

      // Fetch all exams including timing details (casting exam_date to string prevents timezone shifts)
      const examsRes = await pool.query(`
        SELECT id, title, type, total_grade, TO_CHAR(exam_date, 'YYYY-MM-DD') AS exam_date, exam_time, duration_minutes, created_at 
        FROM exams 
        ORDER BY created_at DESC
      `);

      // Fetch all chapters
      const chaptersRes = await pool.query(`
        SELECT id, title FROM chapters ORDER BY title ASC
      `);

      // Fetch exam-chapter relations
      const examChaptersRes = await pool.query(`
        SELECT exam_id, chapter_id FROM exam_chapters
      `);

      // Fetch all users (students)
      const usersRes = await pool.query(`
        SELECT id, full_name, school_name, is_admin FROM users ORDER BY full_name ASC
      `);

      // Fetch all exam grade thresholds
      const thresholdsRes = await pool.query(`
        SELECT id, exam_id, grade_letter, min_score FROM exam_grade_thresholds ORDER BY min_score DESC
      `);

      // Fetch all student grades
      const gradesRes = await pool.query(`
        SELECT id, exam_id, student_id, numeric_grade, letter_grade, comment, updated_at FROM student_grades
      `);

      const students = usersRes.rows.filter((u) => !u.is_admin);

      const exams = examsRes.rows.map((exam) => {
        const examThresholds = thresholdsRes.rows.filter(
          (t) => t.exam_id === exam.id,
        );
        const examGrades = gradesRes.rows.filter((g) => g.exam_id === exam.id);

        // Find chapters for this exam
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
          const foundUserGrade = examGrades.find(
            (g) => g.student_id == user_id,
          );
          if (foundUserGrade) {
            userGradeData = foundUserGrade;
          }
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

      if (user_id !== undefined) {
        return res.status(200).json(exams);
      }

      return res
        .status(200)
        .json({ exams, students, chapters: chaptersRes.rows });
    } else if (method === "POST") {
      const {
        title,
        type,
        total_grade,
        exam_date,
        exam_time,
        duration_minutes,
        thresholds,
        chapter_ids,
      } = req.body;
      if (!title || !type || total_grade === undefined) {
        return res
          .status(400)
          .json({ error: "Title, type, and total_grade are required" });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const examResult = await client.query(
          "INSERT INTO exams (title, type, total_grade, exam_date, exam_time, duration_minutes, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id, title, type, total_grade, TO_CHAR(exam_date, 'YYYY-MM-DD') AS exam_date, exam_time, duration_minutes, created_at",
          [
            title,
            type,
            total_grade,
            exam_date || null,
            exam_time || null,
            duration_minutes || null,
          ],
        );
        const examId = examResult.rows[0].id;

        if (thresholds && Array.isArray(thresholds)) {
          for (let t of thresholds) {
            await client.query(
              "INSERT INTO exam_grade_thresholds (exam_id, grade_letter, min_score) VALUES ($1, $2, $3)",
              [examId, t.grade_letter, t.min_score],
            );
          }
        }

        if (chapter_ids && Array.isArray(chapter_ids)) {
          for (let chId of chapter_ids) {
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
        throw err;
      } finally {
        client.release();
      }
    } else if (method === "PUT") {
      const { action } = req.query;

      if (action === "update-grade") {
        const { exam_id, student_id, numeric_grade, comment } = req.body;
        if (!exam_id || !student_id) {
          return res.status(400).json({ error: "Missing required fields" });
        }

        const threshRes = await pool.query(
          "SELECT grade_letter, min_score FROM exam_grade_thresholds WHERE exam_id = $1 ORDER BY min_score DESC",
          [exam_id],
        );
        const thresholds = threshRes.rows;

        let letter_grade = "F";
        if (
          numeric_grade !== null &&
          numeric_grade !== undefined &&
          !isNaN(numeric_grade)
        ) {
          const scoreNum = parseFloat(numeric_grade);
          for (let t of thresholds) {
            if (scoreNum >= parseFloat(t.min_score)) {
              letter_grade = t.grade_letter;
              break;
            }
          }
        } else {
          letter_grade = null;
        }

        await pool.query(
          `
          INSERT INTO student_grades (exam_id, student_id, numeric_grade, letter_grade, comment, updated_at)
          VALUES ($1, $2, $3, $4, $5, NOW())
          ON CONFLICT (exam_id, student_id)
          DO UPDATE SET numeric_grade = EXCLUDED.numeric_grade, letter_grade = EXCLUDED.letter_grade, comment = EXCLUDED.comment, updated_at = NOW()
        `,
          [
            exam_id,
            student_id,
            numeric_grade !== "" && numeric_grade !== undefined
              ? numeric_grade
              : null,
            letter_grade,
            comment || null,
          ],
        );

        return res
          .status(200)
          .json({ message: "Grade saved successfully", letter_grade });
      } else {
        const {
          id,
          title,
          type,
          total_grade,
          exam_date,
          exam_time,
          duration_minutes,
          thresholds,
          chapter_ids,
        } = req.body;
        if (!id || !title || !type || total_grade === undefined) {
          return res.status(400).json({ error: "Missing required fields" });
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const updateRes = await client.query(
            "UPDATE exams SET title = $1, type = $2, total_grade = $3, exam_date = $4, exam_time = $5, duration_minutes = $6 WHERE id = $7 RETURNING id, title, type, total_grade, TO_CHAR(exam_date, 'YYYY-MM-DD') AS exam_date, exam_time, duration_minutes, created_at",
            [
              title,
              type,
              total_grade,
              exam_date || null,
              exam_time || null,
              duration_minutes || null,
              id,
            ],
          );

          if (updateRes.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Exam not found" });
          }

          if (thresholds && Array.isArray(thresholds)) {
            await client.query(
              "DELETE FROM exam_grade_thresholds WHERE exam_id = $1",
              [id],
            );
            for (let t of thresholds) {
              await client.query(
                "INSERT INTO exam_grade_thresholds (exam_id, grade_letter, min_score) VALUES ($1, $2, $3)",
                [id, t.grade_letter, t.min_score],
              );
            }
          }

          if (chapter_ids && Array.isArray(chapter_ids)) {
            await client.query("DELETE FROM exam_chapters WHERE exam_id = $1", [
              id,
            ]);
            for (let chId of chapter_ids) {
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
    } else if (method === "DELETE") {
      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ error: "Exam ID is required" });
      }

      await pool.query("DELETE FROM exams WHERE id = $1", [id]);
      return res.status(200).json({ message: "Exam deleted successfully" });
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
