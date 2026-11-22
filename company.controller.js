
import { query, pool } from "../config/db.js";
import { notify } from "../utils/notify.js";
import { logActivity } from "../utils/activityLog.js";
import {
  assertTransition,
  allowedNext,
  statusUpdateSql,
} from "../utils/pipeline.js";

// GET /api/companies/me
export const getMyProfile = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT c.*, u.email
       FROM companies c
       JOIN users u ON u.id = c.user_id
       WHERE u.id = $1`,
      [req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Company profile not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

// PUT /api/companies/me
export const updateCompanyProfile = async (req, res, next) => {
  try {
    const { company_name, website, industry, description } = req.body;

    const result = await query(
      `UPDATE companies SET
         company_name = COALESCE($1, company_name),
         website = COALESCE($2, website),
         industry = COALESCE($3, industry),
         description = COALESCE($4, description)
       WHERE user_id = $5
       RETURNING *`,
      [company_name, website, industry, description, req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Company profile not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

// POST /api/companies/jobs
export const createJob = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const companyRes = await client.query(
      "SELECT id, company_name, verification_status FROM companies WHERE user_id=$1",
      [req.user.id]
    );

    if (!companyRes.rows.length) {
      return res.status(404).json({ error: "Company profile not found" });
    }

    if (companyRes.rows[0].verification_status === "rejected") {
      return res.status(403).json({
        error: "Your company verification was rejected. Upload corrected documents to be reviewed again before posting jobs.",
      });
    }

    const companyId = companyRes.rows[0].id;

    const {
      title,
      description,
      location,
      job_type,
      min_cgpa,
      salary_min,
      salary_max,
      application_deadline,
      skills = [],
    } = req.body;

    if (!title || !description) {
      return res.status(400).json({
        error: "title and description are required",
      });
    }

    await client.query("BEGIN");

    const jobRes = await client.query(
      `INSERT INTO jobs
       (company_id, title, description, location, job_type, min_cgpa,
        salary_min, salary_max, application_deadline)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        companyId,
        title,
        description,
        location,
        job_type || "full_time",
        min_cgpa || null,
        salary_min || null,
        salary_max || null,
        application_deadline || null,
      ]
    );

    const jobId = jobRes.rows[0].id;

    for (const s of skills) {
      if (!s.name) continue;

      let skillRow = await client.query(
        "SELECT id FROM skills WHERE name=$1",
        [s.name]
      );

      let skillId;

      if (skillRow.rows.length) {
        skillId = skillRow.rows[0].id;
      } else {
        skillId = (
          await client.query(
            "INSERT INTO skills (name) VALUES ($1) RETURNING id",
            [s.name]
          )
        ).rows[0].id;
      }

      await client.query(
        "INSERT INTO job_skills (job_id, skill_id, is_mandatory) VALUES ($1,$2,$3)",
        [jobId, skillId, s.is_mandatory !== false]
      );
    }

    await client.query("COMMIT");

    await logActivity(req.user.id, "job.created", {
      job_id: jobId,
      title,
    });

    res.status(201).json(jobRes.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

// GET /api/companies/jobs
export const getMyJobs = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT j.*, COUNT(a.id) AS applicant_count
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
       LEFT JOIN applications a ON a.job_id = j.id
       WHERE c.user_id = $1
       GROUP BY j.id
       ORDER BY j.created_at DESC`,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
};

// PATCH /api/companies/jobs/:jobId
export const updateJobStatus = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { status } = req.body;

    if (!["open", "closed"].includes(status)) {
      return res.status(400).json({
        error: "status must be 'open' or 'closed'",
      });
    }

    const result = await query(
      `UPDATE jobs j SET status=$1
       FROM companies c
       WHERE j.company_id = c.id
         AND j.id = $2
         AND c.user_id = $3
       RETURNING j.*`,
      [status, jobId, req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
};

// GET /api/companies/jobs/:jobId/applicants
export const getApplicants = async (req, res, next) => {
  try {
    const { jobId } = req.params;

    const result = await query(
      `SELECT a.id AS application_id, a.status, a.match_score, a.applied_at,
              s.id AS student_id, s.full_name, s.department, s.cgpa, s.ats_score,
              (SELECT r.id FROM resumes r
               WHERE r.student_id = s.id
               ORDER BY r.is_default DESC, r.uploaded_at DESC
               LIMIT 1) AS resume_id,
              (SELECT i.id FROM interviews i
               WHERE i.application_id = a.id
               ORDER BY i.created_at DESC
               LIMIT 1) AS latest_interview_id,
              (SELECT EXISTS (
                 SELECT 1 FROM interview_feedback f
                 JOIN interviews i ON i.id = f.interview_id
                 WHERE i.application_id = a.id
              )) AS has_feedback,
              u.email AS student_email
       FROM applications a
       JOIN students s ON s.id = a.student_id
       JOIN users u ON u.id = s.user_id
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
       WHERE a.job_id = $1 AND c.user_id = $2
       ORDER BY COALESCE(a.match_score, 0) DESC, a.applied_at ASC`,
      [jobId, req.user.id]
    );

    res.json(
      result.rows.map((r) => ({
        ...r,
        allowed_next: allowedNext(r.status),
      }))
    );
  } catch (err) {
    next(err);
  }
};

// PATCH /api/companies/applications/:applicationId
export const updateApplicationStatus = async (req, res, next) => {
  try {
    const { applicationId } = req.params;
    const { final_salary } = req.body;

    // Normalise the requested status
    const requestedStatus = req.body.status;

    const status =
      typeof requestedStatus === "string"
        ? requestedStatus.trim().toLowerCase()
        : requestedStatus;

    if (!status) {
      return res.status(400).json({
        error: "Application status is required",
      });
    }

    const current = await query(
      `SELECT a.id, a.status
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
       WHERE a.id = $1 AND c.user_id = $2`,
      [applicationId, req.user.id]
    );

    if (!current.rows.length) {
      return res.status(404).json({
        error: "Application not found",
      });
    }

    // Interview statuses must be updated through interview endpoints
    if (
      ["interview_scheduled", "interview_completed"].includes(status)
    ) {
      return res.status(400).json({
        error:
          status === "interview_scheduled"
            ? "Use the schedule-interview action to move an application to interview_scheduled"
            : "An application moves to interview_completed when interview feedback is submitted",
      });
    }

    const currentStatus = String(
      current.rows[0].status || ""
    ).trim().toLowerCase();

    const problem = assertTransition(currentStatus, status);

    if (problem) {
      return res.status(409).json({ error: problem });
    }

    const result = await query(
      `UPDATE applications a
       SET ${statusUpdateSql(1, 4)},
           final_salary = COALESCE($5, a.final_salary)
       FROM jobs j, companies c
       WHERE a.job_id = j.id
         AND j.company_id = c.id
         AND a.id = $2
         AND c.user_id = $3
       RETURNING a.*, j.title AS job_title, c.company_name,
                 (SELECT user_id FROM students WHERE id = a.student_id) AS student_user_id`,
      [
        status,
        applicationId,
        req.user.id,
        req.user.id,
        status === "selected" ? final_salary || null : null,
      ]
    );

    const app = result.rows[0];

    await notify(
      app.student_user_id,
      "Application update",
      `Your application for "${app.job_title}" at ${app.company_name} is now "${status.replace(/_/g, " ")}".`
    );

    await logActivity(req.user.id, "application.status_changed", {
      application_id: applicationId,
      from: currentStatus,
      status,
    });

    res.json({
      ...app,
      allowed_next: allowedNext(status),
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/companies/applications/:applicationId/interview
export const scheduleInterview = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { applicationId } = req.params;
    const { scheduled_at, mode, interviewer_name } = req.body;

    if (!scheduled_at) {
      return res.status(400).json({
        error: "scheduled_at is required",
      });
    }

    const ownershipCheck = await client.query(
      `SELECT a.id, a.status, j.title AS job_title, c.company_name,
              (SELECT user_id FROM students WHERE id = a.student_id) AS student_user_id
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
       WHERE a.id = $1 AND c.user_id = $2`,
      [applicationId, req.user.id]
    );

    if (!ownershipCheck.rows.length) {
      return res.status(404).json({
        error: "Application not found or you don't have access to it",
      });
    }

    const app = ownershipCheck.rows[0];
    const problem = assertTransition(app.status, "interview_scheduled");

    if (problem) {
      return res.status(409).json({
        error: `Cannot schedule an interview: ${problem}. Shortlist the candidate first.`,
      });
    }

    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO interviews
       (application_id, scheduled_at, mode, interviewer_name)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [applicationId, scheduled_at, mode || "online", interviewer_name || null]
    );

    await client.query(
      `UPDATE applications
       SET ${statusUpdateSql(1, 3)}
       WHERE id = $2`,
      ["interview_scheduled", applicationId, req.user.id]
    );

    await client.query("COMMIT");

    await notify(
      app.student_user_id,
      "Interview scheduled",
      `${app.company_name} scheduled an interview for "${app.job_title}" on ${new Date(scheduled_at).toLocaleString()}.`
    );

    await logActivity(req.user.id, "interview.scheduled", {
      application_id: applicationId,
      scheduled_at,
    });

    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

// GET /api/companies/applications/:applicationId/interviews
export const getInterviewsForApplication = async (req, res, next) => {
  try {
    const { applicationId } = req.params;

    const result = await query(
      `SELECT i.*
       FROM interviews i
       JOIN applications a ON a.id = i.application_id
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
       WHERE a.id = $1 AND c.user_id = $2
       ORDER BY i.scheduled_at DESC`,
      [applicationId, req.user.id]
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
};

// POST /api/companies/interviews/:interviewId/feedback
export const submitInterviewFeedback = async (req, res, next) => {
  const client = await pool.connect();

  try {
    const { interviewId } = req.params;
    const f = req.body;

    const own = await client.query(
      `SELECT i.id, a.id AS application_id, a.status,
              j.title AS job_title, c.company_name,
              (SELECT user_id FROM students WHERE id = a.student_id) AS student_user_id
       FROM interviews i
       JOIN applications a ON a.id = i.application_id
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
       WHERE i.id = $1 AND c.user_id = $2`,
      [interviewId, req.user.id]
    );

    if (!own.rows.length) {
      return res.status(404).json({
        error: "Interview not found or you don't have access to it",
      });
    }

    const row = own.rows[0];

    const dup = await client.query(
      "SELECT 1 FROM interview_feedback WHERE interview_id = $1",
      [interviewId]
    );

    if (dup.rows.length) {
      return res.status(409).json({
        error: "Feedback has already been submitted for this interview",
      });
    }

    const problem = assertTransition(row.status, "interview_completed");

    if (problem) {
      return res.status(409).json({ error: problem });
    }

    const score = Math.round(
      ((f.technical_rating + f.problem_solving_rating + f.communication_rating) / 3) * 10
    ) / 10;

    await client.query("BEGIN");

    const fb = await client.query(
      `INSERT INTO interview_feedback
       (interview_id, technical_rating, problem_solving_rating,
        communication_rating, score, strengths, weaknesses, comments,
        recommendation, submitted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        interviewId,
        f.technical_rating,
        f.problem_solving_rating,
        f.communication_rating,
        score,
        f.strengths || null,
        f.weaknesses || null,
        f.comments || null,
        f.recommendation,
        req.user.id,
      ]
    );

    await client.query(
      "UPDATE interviews SET status = 'completed' WHERE id = $1",
      [interviewId]
    );

    await client.query(
      `UPDATE applications
       SET ${statusUpdateSql(1, 3)}
       WHERE id = $2`,
      ["interview_completed", row.application_id, req.user.id]
    );

    await client.query("COMMIT");

    await notify(
      row.student_user_id,
      "Interview completed",
      `${row.company_name} has recorded feedback for your "${row.job_title}" interview. You'll be notified of the final decision.`
    );

    await logActivity(req.user.id, "interview.feedback_submitted", {
      interview_id: interviewId,
      recommendation: f.recommendation,
    });

    res.status(201).json({
      ...fb.rows[0],
      allowed_next: allowedNext("interview_completed"),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

// GET /api/companies/analytics
export const getRecruiterAnalytics = async (req, res, next) => {
  try {
    const companyRes = await query(
      "SELECT id FROM companies WHERE user_id=$1",
      [req.user.id]
    );

    if (!companyRes.rows.length) {
      return res.status(404).json({
        error: "Company profile not found",
      });
    }

    const companyId = companyRes.rows[0].id;

    const [funnel, perJob, feedback] = await Promise.all([
      query(
        `SELECT a.status, COUNT(*)::int AS count
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
         WHERE j.company_id=$1
         GROUP BY a.status`,
        [companyId]
      ),

      query(
        `SELECT j.id, j.title, j.status,
                COUNT(a.id)::int AS applicants,
                COUNT(a.id) FILTER (
                  WHERE LOWER(BTRIM(a.status))='shortlisted'
                )::int AS shortlisted,
                COUNT(a.id) FILTER (
                  WHERE LOWER(BTRIM(a.status))='selected'
                )::int AS selected,
                ROUND(AVG(a.match_score)::numeric, 1) AS avg_match_score
         FROM jobs j
         LEFT JOIN applications a ON a.job_id = j.id
         WHERE j.company_id=$1
         GROUP BY j.id
         ORDER BY j.created_at DESC`,
        [companyId]
      ),

      query(
        `SELECT ROUND(AVG(f.score), 1) AS avg_interview_score,
                COUNT(*)::int AS interviews_reviewed
         FROM interview_feedback f
         JOIN interviews i ON i.id = f.interview_id
         JOIN applications a ON a.id = i.application_id
         JOIN jobs j ON j.id = a.job_id
         WHERE j.company_id=$1`,
        [companyId]
      ),
    ]);

    const byStatus = Object.fromEntries(
      funnel.rows.map((r) => [
        String(r.status).trim().toLowerCase(),
        r.count,
      ])
    );

    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

    res.json({
      total_applications: total,
      funnel: byStatus,
      selection_rate: total
        ? Math.round(((byStatus.selected || 0) / total) * 100)
        : 0,
      per_job: perJob.rows,
      interviews: feedback.rows[0],
    });
  } catch (err) {
    next(err);
  }
};
