import axios from "axios";
import fs from "fs";
import FormData from "form-data";
import { query, pool } from "../config/db.js";
import { logActivity } from "../utils/activityLog.js";
import { readinessForStudent } from "../utils/readiness.js";
import { buildIcs } from "../utils/ics.js";

// GET /api/students/me
export const getMyProfile = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT s.*, u.email FROM students s JOIN users u ON s.user_id = u.id WHERE u.id = $1`,
      [req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Profile not found" });

    const student = result.rows[0];
    const [skills, education, projects, experiences, certificates] = await Promise.all([
      query(`SELECT sk.id, sk.name, ss.proficiency FROM student_skills ss
             JOIN skills sk ON sk.id = ss.skill_id WHERE ss.student_id=$1`, [student.id]),
      query(`SELECT * FROM education WHERE student_id=$1`, [student.id]),
      query(`SELECT * FROM projects WHERE student_id=$1`, [student.id]),
      query(`SELECT * FROM experiences WHERE student_id=$1`, [student.id]),
      query(`SELECT * FROM certificates WHERE student_id=$1`, [student.id]),
    ]);

    const defaultResume = await query(
      `SELECT id FROM resumes WHERE student_id=$1 ORDER BY is_default DESC, uploaded_at DESC LIMIT 1`, [student.id]);

    res.json({
      ...student,
      resume_id: defaultResume.rows[0]?.id || null,
      skills: skills.rows,
      education: education.rows,
      projects: projects.rows,
      experiences: experiences.rows,
      certificates: certificates.rows,
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/students/me
export const updateMyProfile = async (req, res, next) => {
  try {
    const { full_name, phone, department, cgpa, graduation_year } = req.body;
    if (cgpa != null && (Number(cgpa) < 0 || Number(cgpa) > 10)) {
      return res.status(400).json({ error: "cgpa must be between 0 and 10" });
    }
    const result = await query(
      `UPDATE students SET
         full_name = COALESCE($1, full_name),
         phone = COALESCE($2, phone),
         department = COALESCE($3, department),
         cgpa = COALESCE($4, cgpa),
         graduation_year = COALESCE($5, graduation_year)
       WHERE user_id = $6 RETURNING *`,
      [full_name || null, phone || null, department || null, cgpa || null, graduation_year || null, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

// PUT /api/students/me/skills   body: { skills: [{name, proficiency}] }
export const setMySkills = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { skills } = req.body; // [{name, proficiency}]
   
const studentRes = await client.query(
  "SELECT id FROM students WHERE user_id=$1",
  [req.user.id]
);

const studentId = studentRes.rows[0]?.id;

if (!studentId) {
  return res.status(404).json({
    error: "Student profile not found"
  });
}

    await client.query("BEGIN");
    await client.query("DELETE FROM student_skills WHERE student_id=$1", [studentId]);
    for (const s of skills || []) {
      if (!s.name) continue;
      let skillRow = await client.query("SELECT id FROM skills WHERE name=$1", [s.name]);
      let skillId;
      if (skillRow.rows.length) {
        skillId = skillRow.rows[0].id;
      } else {
        const inserted = await client.query(
          "INSERT INTO skills (name) VALUES ($1) RETURNING id", [s.name]
        );
        skillId = inserted.rows[0].id;
      }
      await client.query(
        "INSERT INTO student_skills (student_id, skill_id, proficiency) VALUES ($1,$2,$3)",
        [studentId, skillId, s.proficiency || "intermediate"]
      );
    }
    await client.query("COMMIT");
    res.json({ message: "Skills updated" });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

// Looks up a job's required skill names. Shared by resume scoring and
// mock-interview generation so both can be "job-specific".
const getJobRequiredSkills = async (jobId) => {
  if (!jobId) return [];
  const res = await query(
    `SELECT sk.name FROM job_skills js JOIN skills sk ON sk.id = js.skill_id WHERE js.job_id = $1`,
    [jobId]
  );
  return res.rows.map((r) => r.name);
};

// POST /api/students/me/resume  (multipart: file field "resume", optional field "job_id")
// Uploads file, then calls the AI service to parse + score it.
// FIX: previously always scored against a generic keyword list regardless
// of which job the student cared about. If job_id is provided, we fetch
// that job's required skills and score against those instead — so a
// student targeting a Java role is scored on Java-relevant keywords, not
// an unrelated generic list.
export const uploadResume = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "resume file is required" });

    const studentRes = await query("SELECT id FROM students WHERE user_id=$1", [req.user.id]);
    const studentId = studentRes.rows[0].id;
    // file_url is kept only as a legacy/display field — it is NOT web-servable
    // any more (the public /uploads static mount was removed in V3). The
    // actual file is only reachable through the authenticated
    // /api/resumes/:id/download route, which reads file_path.
    const fileUrl = `/uploads/${req.file.filename}`;
    const filePath = req.file.path;
    const label = req.body.label || "General Resume";
    const jobId = req.body.job_id || null;

    const targetKeywords = jobId ? await getJobRequiredSkills(jobId) : [];

    let parsed = null, atsScore = null, missingKeywords = [], fullText = null, suggestions = [], breakdown = null;
    try {
      const form = new FormData();
      form.append("file", fs.createReadStream(req.file.path), req.file.filename);
      if (targetKeywords.length) {
        form.append("target_keywords", targetKeywords.join(","));
      }
      const aiRes = await axios.post(
        `${process.env.AI_SERVICE_URL}/resume/parse`,
        form,
        { headers: form.getHeaders() }
      );
      parsed = aiRes.data.parsed;
      atsScore = aiRes.data.ats_score;
      missingKeywords = aiRes.data.missing_keywords || [];
      suggestions = aiRes.data.suggestions || [];
      breakdown = aiRes.data.score_breakdown || null;
      fullText = parsed?.full_text || null;
    } catch (aiErr) {
      console.warn("AI service unavailable, storing resume without parsing:", aiErr.message);
    }

    const resumeRow = await query(
      `INSERT INTO resumes (student_id, file_url, file_path, label, parsed_json, ats_score, missing_keywords)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [studentId, fileUrl, filePath, label, parsed, atsScore, missingKeywords]
    );

    await query(
      `UPDATE students SET resume_url=$1, ats_score=$2 WHERE id=$3`,
      [fileUrl, atsScore, studentId]
    );

    // V3: first resume becomes the default automatically.
    const resumeId = resumeRow.rows[0].id;
    const countRes = await query(`SELECT count(*) FROM resumes WHERE student_id=$1`, [studentId]);
    if (parseInt(countRes.rows[0].count, 10) === 1) {
      await query(`UPDATE resumes SET is_default=TRUE WHERE id=$1`, [resumeId]);
    }

    // V3: persist structured parse + score history (only if AI service responded).
    if (parsed) {
      await query(
        `INSERT INTO resume_parsed_data (resume_id, full_name, emails, phones, education, experience, projects, certifications)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [resumeId, parsed.full_name || null, parsed.contact?.emails || [], parsed.contact?.phones || [],
         JSON.stringify(parsed.education || []), JSON.stringify(parsed.experience || []),
         JSON.stringify(parsed.projects || []), JSON.stringify(parsed.certifications || [])]
      );
      await query(
        `INSERT INTO resume_ats_history (resume_id, student_id, job_id, overall_score, breakdown, missing_keywords)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [resumeId, studentId, jobId, atsScore, JSON.stringify(breakdown), missingKeywords]
      );
    }

    await logActivity(req.user.id, "resume.uploaded", { job_id: jobId, ats_score: atsScore });

    res.status(201).json({
      ...resumeRow.rows[0],
      suggestions,
      score_breakdown: breakdown,
      scored_against_job: Boolean(jobId && targetKeywords.length),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/students/me/resumes — upload history (all past versions, newest first)
export const getResumeHistory = async (req, res, next) => {
  try {
    const studentRes = await query("SELECT id FROM students WHERE user_id=$1", [req.user.id]);
    if (!studentRes.rows.length) return res.status(404).json({ error: "Student profile not found" });

    const result = await query(
      `SELECT id, label, is_default, ats_score, missing_keywords, uploaded_at
       FROM resumes WHERE student_id=$1 ORDER BY uploaded_at DESC`,
      [studentRes.rows[0].id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
};

// GET /api/students/me/resume/match/:jobId
// Re-scores the student's most recently uploaded resume against a
// SPECIFIC job's required skills, without needing a re-upload — uses the
// full_text captured at upload time plus the AI service's /resume/rescore.
export const getResumeMatchForJob = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const studentRes = await query("SELECT id FROM students WHERE user_id=$1", [req.user.id]);
    if (!studentRes.rows.length) return res.status(404).json({ error: "Student profile not found" });

    const resumeRes = await query(
      `SELECT id, parsed_json FROM resumes WHERE student_id=$1
       ORDER BY is_default DESC, uploaded_at DESC LIMIT 1`,
      [studentRes.rows[0].id]
    );
    if (!resumeRes.rows.length || !resumeRes.rows[0].parsed_json?.full_text) {
      return res.status(404).json({ error: "No analyzed resume found. Upload a resume first." });
    }
    const parsed = resumeRes.rows[0].parsed_json;
    const targetKeywords = await getJobRequiredSkills(jobId);
    if (!targetKeywords.length) {
      return res.status(400).json({ error: "This job has no required skills listed to score against" });
    }

    const aiRes = await axios.post(`${process.env.AI_SERVICE_URL}/resume/rescore`, {
      full_text: parsed.full_text,
      skills: parsed.skills || [],
      target_keywords: targetKeywords,
      education: parsed.education || [],
      experience: parsed.experience || [],
      projects: parsed.projects || [],
      certifications: parsed.certifications || [],
      contact: parsed.contact || {},
    });

    await query(
      `INSERT INTO resume_ats_history (resume_id, student_id, job_id, overall_score, breakdown, missing_keywords)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [resumeRes.rows[0].id, studentRes.rows[0].id, jobId, aiRes.data.ats_score,
       JSON.stringify(aiRes.data.score_breakdown), aiRes.data.missing_keywords || []]
    );

    res.json(aiRes.data);
  } catch (err) {
    next(err);
  }
};

// GET /api/students/me/recommendations
// Fetches open jobs + delegates similarity ranking to the AI service.
export const getJobRecommendations = async (req, res, next) => {
  try {
    const studentRes = await query(
      `SELECT s.id, s.resume_url, s.cgpa, array_agg(sk.name) AS skills
       FROM students s
       LEFT JOIN student_skills ss ON ss.student_id = s.id
       LEFT JOIN skills sk ON sk.id = ss.skill_id
       WHERE s.user_id = $1 GROUP BY s.id`,
      [req.user.id]
    );
    const student = studentRes.rows[0];
    if (!student) {
      return res.status(404).json({ error: "Student profile not found" });
    }

   
const jobsRes = await query(
  `SELECT
      j.id,
      j.title,
      j.description,
      c.company_name,
      array_agg(sk.name) AS required_skills
   FROM jobs j
   JOIN companies c ON c.id = j.company_id
   LEFT JOIN job_skills js ON js.job_id = j.id
   LEFT JOIN skills sk ON sk.id = js.skill_id
   WHERE j.status = 'open'
     AND (j.application_deadline IS NULL OR j.application_deadline >= CURRENT_DATE)
     AND (j.min_cgpa IS NULL OR $1::numeric IS NULL OR j.min_cgpa <= $1::numeric)
     AND NOT EXISTS (
       SELECT 1
       FROM applications a
       WHERE a.job_id = j.id
         AND a.student_id = $2
     )
   GROUP BY j.id, c.company_name`,
  [student.cgpa, student.id]
);

    const studentSkills = (student.skills || []).filter(Boolean);
    const aiRes = await axios.post(`${process.env.AI_SERVICE_URL}/jobs/recommend`, {
      student_skills: studentSkills,
      jobs: jobsRes.rows.map((j) => ({
        id: j.id,
        title: j.title,
        description: j.description,
        required_skills: (j.required_skills || []).filter(Boolean),
      })),
    });

    res.json(aiRes.data.recommendations);
  } catch (err) {
    next(err);
  }
};

// GET /api/students/me/skill-gap?job_id=...
export const getSkillGap = async (req, res, next) => {
  try {
    const { job_id } = req.query;
    if (!job_id) return res.status(400).json({ error: "job_id is required" });

    const studentRes = await query(
      `SELECT s.id, array_agg(sk.name) AS skills FROM students s
       LEFT JOIN student_skills ss ON ss.student_id = s.id
       LEFT JOIN skills sk ON sk.id = ss.skill_id
       WHERE s.user_id=$1 GROUP BY s.id`,
      [req.user.id]
    );
    const jobRes = await query(
      `SELECT array_agg(sk.name) AS required_skills FROM job_skills js
       JOIN skills sk ON sk.id = js.skill_id WHERE js.job_id=$1`,
      [job_id]
    );

    const have = new Set((studentRes.rows[0]?.skills || []).filter(Boolean));
    const required = (jobRes.rows[0]?.required_skills || []).filter(Boolean);
    const missing = required.filter((s) => !have.has(s));

    res.json({
      required,
      have: [...have],
      missing,
      match_percent: required.length
        ? Math.round(((required.length - missing.length) / required.length) * 100)
        : 100,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/students/me/applications
export const getMyApplications = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT a.*, j.title, c.company_name FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
       JOIN students s ON s.id = a.student_id
       WHERE s.user_id = $1 ORDER BY a.applied_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
};

// GET /api/students/me/interviews — upcoming + past interviews across all applications
export const getMyInterviews = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT i.*, j.title AS job_title, c.company_name
       FROM interviews i
       JOIN applications a ON a.id = i.application_id
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
       JOIN students s ON s.id = a.student_id
       WHERE s.user_id = $1
       ORDER BY i.scheduled_at ASC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
};

// POST /api/students/me/mock-interview  body: { job_id }
// FIX: previously ignored job_id entirely and only used the student's own
// skills. Now, when a job_id is given, we union the student's skills with
// that job's required skills so questions cover gap areas too (e.g. a
// student who hasn't listed Docker but is applying to a Docker-heavy role
// still gets Docker questions to prep for).
export const generateMockInterview = async (req, res, next) => {
  try {
    const { job_id, difficulty = "intermediate" } = req.body;
    if (!["beginner", "intermediate", "advanced"].includes(difficulty)) {
      return res.status(400).json({ error: "difficulty must be beginner, intermediate or advanced" });
    }
    const studentRes = await query(
      `SELECT s.id, array_agg(sk.name) AS skills FROM students s
       LEFT JOIN student_skills ss ON ss.student_id = s.id
       LEFT JOIN skills sk ON sk.id = ss.skill_id
       WHERE s.user_id=$1 GROUP BY s.id`,
      [req.user.id]
    );
    const student = studentRes.rows[0];
    if (!student) return res.status(404).json({ error: "Student profile not found" });

    const studentSkills = (student.skills || []).filter(Boolean);
    const jobSkills = job_id ? await getJobRequiredSkills(job_id) : [];
    const combinedSkills = [...new Set([...studentSkills, ...jobSkills])];

    const aiRes = await axios.post(`${process.env.AI_SERVICE_URL}/interview/generate`, {
      skills: combinedSkills,
      difficulty,
    });

    const saved = await query(
      `INSERT INTO mock_interviews (student_id, job_id, questions, difficulty) VALUES ($1,$2,$3,$4) RETURNING *`,
      [student.id, job_id || null, JSON.stringify(aiRes.data.questions), difficulty]
    );

    res.status(201).json(saved.rows[0]);
  } catch (err) {
    next(err);
  }
};

// GET /api/students/me/resume/improve — wording/structure suggestions for the
// default (else latest) resume. Never invents content; see ai-service/resume_improver.py.
export const getResumeImprovements = async (req, res, next) => {
  try {
    const studentRes = await query("SELECT id FROM students WHERE user_id=$1", [req.user.id]);
    if (!studentRes.rows.length) return res.status(404).json({ error: "Student profile not found" });
    const resumeRes = await query(
      `SELECT parsed_json FROM resumes WHERE student_id=$1 AND parsed_json IS NOT NULL
       ORDER BY is_default DESC, uploaded_at DESC LIMIT 1`,
      [studentRes.rows[0].id]
    );
    if (!resumeRes.rows.length) return res.status(404).json({ error: "No analyzed resume found. Upload a resume first." });
    const p = resumeRes.rows[0].parsed_json;
    const aiRes = await axios.post(`${process.env.AI_SERVICE_URL}/resume/improve`, {
      experience: p.experience || [], projects: p.projects || [],
      certifications: p.certifications || [], skills: p.skills || [], contact: p.contact || {},
    });
    res.json(aiRes.data);
  } catch (err) { next(err); }
};

// GET /api/students/me/resume/score-history — ATS score trend over time
export const getAtsHistory = async (req, res, next) => {
  try {
    const studentRes = await query("SELECT id FROM students WHERE user_id=$1", [req.user.id]);
    if (!studentRes.rows.length) return res.status(404).json({ error: "Student profile not found" });
    const result = await query(
      `SELECT h.id, h.overall_score, h.scored_at, h.job_id, j.title AS job_title, r.label
       FROM resume_ats_history h
       JOIN resumes r ON r.id = h.resume_id
       LEFT JOIN jobs j ON j.id = h.job_id
       WHERE h.student_id=$1 ORDER BY h.scored_at DESC LIMIT 50`,
      [studentRes.rows[0].id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
};

// POST /api/students/me/mock-interview/:id/answers
// body: { question_index, answer_text } — evaluates via the AI service and
// stores both the answer and its (explainable) evaluation. Re-answering a
// question replaces the previous attempt.
export const submitMockAnswer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { question_index, answer_text } = req.body;
    if (question_index === undefined || !answer_text?.trim()) {
      return res.status(400).json({ error: "question_index and answer_text are required" });
    }

    const mockRes = await query(
      `SELECT m.* FROM mock_interviews m JOIN students s ON s.id = m.student_id
       WHERE m.id=$1 AND s.user_id=$2`, [id, req.user.id]);
    if (!mockRes.rows.length) return res.status(404).json({ error: "Mock interview not found" });

    const questions = typeof mockRes.rows[0].questions === "string"
      ? JSON.parse(mockRes.rows[0].questions) : mockRes.rows[0].questions;
    const q = questions[question_index];
    if (!q) return res.status(400).json({ error: "question_index out of range" });
    const questionText = typeof q === "string" ? q : q.question;

    const aiRes = await axios.post(`${process.env.AI_SERVICE_URL}/interview/evaluate`, {
      question: questionText, answer: answer_text, concepts: q.concepts || [],
    });
    const ev = aiRes.data;

    await query(`DELETE FROM interview_answers WHERE mock_interview_id=$1 AND question_index=$2`, [id, question_index]);
    const ans = await query(
      `INSERT INTO interview_answers (mock_interview_id, question_index, question_text, answer_text)
       VALUES ($1,$2,$3,$4) RETURNING id`, [id, question_index, questionText, answer_text]);
    await query(
      `INSERT INTO interview_evaluations (answer_id, technical_score, conceptual_score, explanation_score, completeness_score, overall_score, feedback)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [ans.rows[0].id, ev.technical_score, ev.conceptual_score, ev.explanation_score,
       ev.completeness_score, ev.overall_score, JSON.stringify(ev.feedback)]);

    res.status(201).json({ answer_id: ans.rows[0].id, ...ev });
  } catch (err) { next(err); }
};

// GET /api/students/me/mock-interviews — history with average score
export const listMockInterviews = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT m.id, m.difficulty, m.created_at, j.title AS job_title,
              jsonb_array_length(m.questions::jsonb) AS question_count,
              (SELECT count(*) FROM interview_answers a WHERE a.mock_interview_id = m.id) AS answered,
              (SELECT round(avg(e.overall_score), 1) FROM interview_answers a
                 JOIN interview_evaluations e ON e.answer_id = a.id WHERE a.mock_interview_id = m.id) AS avg_score
       FROM mock_interviews m JOIN students s ON s.id = m.student_id
       LEFT JOIN jobs j ON j.id = m.job_id
       WHERE s.user_id=$1 ORDER BY m.created_at DESC LIMIT 30`, [req.user.id]);
    res.json(result.rows);
  } catch (err) { next(err); }
};

// GET /api/students/me/mock-interview/:id — questions + answers + evaluations
export const getMockInterview = async (req, res, next) => {
  try {
    const mockRes = await query(
      `SELECT m.* FROM mock_interviews m JOIN students s ON s.id = m.student_id
       WHERE m.id=$1 AND s.user_id=$2`, [req.params.id, req.user.id]);
    if (!mockRes.rows.length) return res.status(404).json({ error: "Mock interview not found" });
    const answers = await query(
      `SELECT a.question_index, a.answer_text, e.overall_score, e.technical_score, e.conceptual_score,
              e.explanation_score, e.completeness_score, e.feedback
       FROM interview_answers a LEFT JOIN interview_evaluations e ON e.answer_id = a.id
       WHERE a.mock_interview_id=$1 ORDER BY a.question_index`, [req.params.id]);
    res.json({ ...mockRes.rows[0], answers: answers.rows });
  } catch (err) { next(err); }
};

// GET /api/students/me/readiness — transparent rule-based readiness score.
// Each calculation is stored (method='rule_based') so progress can be charted.
export const getMyReadiness = async (req, res, next) => {
  try {
    const studentRes = await query("SELECT id FROM students WHERE user_id=$1", [req.user.id]);
    if (!studentRes.rows.length) return res.status(404).json({ error: "Student profile not found" });
    const studentId = studentRes.rows[0].id;
    const result = await readinessForStudent(query, studentId);
    await query(
      `INSERT INTO prediction_results (student_id, readiness_score, factors, method) VALUES ($1,$2,$3,'rule_based')`,
      [studentId, result.readiness, JSON.stringify(result.factors)]
    );
    const history = await query(
      `SELECT readiness_score, created_at FROM prediction_results WHERE student_id=$1 ORDER BY created_at DESC LIMIT 20`,
      [studentId]
    );
    res.json({ ...result, history: history.rows.reverse() });
  } catch (err) { next(err); }
};

// GET /api/students/me/interviews/calendar.ics — all upcoming interviews as an .ics
// file the student can import into Google/Apple/Outlook calendar.
export const exportInterviewsIcs = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT i.id, i.scheduled_at, i.mode, i.interviewer_name, j.title AS job_title, c.company_name
       FROM interviews i
       JOIN applications a ON a.id = i.application_id
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
       JOIN students s ON s.id = a.student_id
       WHERE s.user_id = $1 AND i.scheduled_at IS NOT NULL AND i.status = 'scheduled'
       ORDER BY i.scheduled_at`,
      [req.user.id]
    );
    const ics = buildIcs(result.rows.map((r) => ({
      uid: r.id,
      start: r.scheduled_at,
      summary: `Interview: ${r.job_title} @ ${r.company_name}`,
      description: `Mode: ${r.mode}${r.interviewer_name ? `\nInterviewer: ${r.interviewer_name}` : ""}`,
      location: r.mode === "offline" ? r.company_name : "Online",
    })));
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="interviews.ics"');
    res.send(ics);
  } catch (err) { next(err); }
};
