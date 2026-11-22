import path from "path";
import fs from "fs";
import { query } from "../config/db.js";
import { logActivity } from "../utils/activityLog.js";
import { logger } from "../utils/logger.js";
import { ok, fail } from "../utils/response.js";

// V3: resumes previously lived behind a public `/uploads` static mount —
// any URL leak exposed a student's full resume to the internet. Every
// read below instead goes through this controller, which always checks
// who is asking before returning any file content or metadata.
//
// Access rule, enforced consistently in every handler:
//   - the owning student: always
//   - company/placement_officer/admin: only for a resume belonging to a
//     student who actually applied to one of their jobs (companies) or
//     at all (officers/admins, who oversee the whole pipeline)
const canAccessResume = async (resumeRow, user) => {
  if (user.role === "admin" || user.role === "placement_officer") return true;

  const studentUserRes = await query(`SELECT user_id FROM students WHERE id = $1`, [resumeRow.student_id]);
  if (studentUserRes.rows.length && studentUserRes.rows[0].user_id === user.id) return true;

  if (user.role === "company") {
    const companyRes = await query(`SELECT id FROM companies WHERE user_id = $1`, [user.id]);
    if (!companyRes.rows.length) return false;
    const companyId = companyRes.rows[0].id;
    const appliedRes = await query(
      `SELECT 1 FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE a.student_id = $1 AND j.company_id = $2 LIMIT 1`,
      [resumeRow.student_id, companyId]
    );
    return appliedRes.rows.length > 0;
  }
  return false;
};

const getResumeOr404 = async (id, res) => {
  const result = await query(`SELECT * FROM resumes WHERE id = $1`, [id]);
  if (!result.rows.length) {
    fail(res, 404, "Resume not found");
    return null;
  }
  return result.rows[0];
};

// GET /api/resumes/:id — metadata (no file bytes)
export const getResumeMeta = async (req, res, next) => {
  try {
    const resume = await getResumeOr404(req.params.id, res);
    if (!resume) return;
    if (!(await canAccessResume(resume, req.user))) {
      return fail(res, 403, "You don't have permission to view this resume");
    }
    const { file_path, ...safe } = resume;
    ok(res, safe);
  } catch (err) {
    next(err);
  }
};

// GET /api/resumes/:id/download — streams the actual file
export const downloadResume = async (req, res, next) => {
  try {
    const resume = await getResumeOr404(req.params.id, res);
    if (!resume) return;
    if (!(await canAccessResume(resume, req.user))) {
      return fail(res, 403, "You don't have permission to download this resume");
    }

    const filePath = resume.file_path || resume.file_url;
    if (!filePath || !fs.existsSync(filePath)) {
      return fail(res, 404, "Resume file is missing from storage");
    }

    await logActivity(req.user.id, "resume.downloaded", { resume_id: resume.id, by: req.user.role });
    res.download(path.resolve(filePath));
  } catch (err) {
    next(err);
  }
};

// DELETE /api/resumes/:id — only the owning student (or an admin) may delete
export const deleteResume = async (req, res, next) => {
  try {
    const resume = await getResumeOr404(req.params.id, res);
    if (!resume) return;

    const studentUserRes = await query(`SELECT user_id FROM students WHERE id = $1`, [resume.student_id]);
    const isOwner = studentUserRes.rows.length && studentUserRes.rows[0].user_id === req.user.id;
    if (!isOwner && req.user.role !== "admin") {
      return fail(res, 403, "Only the owning student or an admin can delete a resume");
    }

    await query(`DELETE FROM resumes WHERE id = $1`, [resume.id]);

    const filePath = resume.file_path || resume.file_url;
    if (filePath && fs.existsSync(filePath)) {
      fs.unlink(filePath, (err) => {
        if (err) logger.warn("Failed to remove resume file from disk", { filePath, error: err.message });
      });
    }

    await logActivity(req.user.id, "resume.deleted", { resume_id: resume.id });
    ok(res, { message: "Resume deleted" });
  } catch (err) {
    next(err);
  }
};

// GET /api/resumes/student/:studentId — list a student's resumes
// Same access rule as above; a student always sees their own, companies
// only see resumes of students who applied to one of their jobs.
export const listResumesForStudent = async (req, res, next) => {
  try {
    const { studentId } = req.params;
    const studentUserRes = await query(`SELECT user_id FROM students WHERE id = $1`, [studentId]);
    if (!studentUserRes.rows.length) return fail(res, 404, "Student not found");

    const fakeResumeRow = { student_id: studentId };
    if (!(await canAccessResume(fakeResumeRow, req.user))) {
      return fail(res, 403, "You don't have permission to view this student's resumes");
    }

    const result = await query(
      `SELECT id, label, is_default, ats_score, missing_keywords, uploaded_at
       FROM resumes WHERE student_id = $1 ORDER BY uploaded_at DESC`,
      [studentId]
    );
    ok(res, result.rows);
  } catch (err) {
    next(err);
  }
};

// PATCH /api/resumes/:id/default — mark one resume as the student's default
export const setDefaultResume = async (req, res, next) => {
  try {
    const resume = await getResumeOr404(req.params.id, res);
    if (!resume) return;
    const studentUserRes = await query(`SELECT user_id FROM students WHERE id = $1`, [resume.student_id]);
    if (!studentUserRes.rows.length || studentUserRes.rows[0].user_id !== req.user.id) {
      return fail(res, 403, "Only the owning student can set a default resume");
    }

    await query(`UPDATE resumes SET is_default = FALSE WHERE student_id = $1`, [resume.student_id]);
    await query(`UPDATE resumes SET is_default = TRUE WHERE id = $1`, [resume.id]);
    ok(res, { message: "Default resume updated" });
  } catch (err) {
    next(err);
  }
};
