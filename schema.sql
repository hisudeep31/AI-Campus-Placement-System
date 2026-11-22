-- =========================================================
-- Placement Management Platform — PostgreSQL Schema
-- ~20 tables, normalized, with FKs and sensible indexes
-- =========================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------- ROLES & USERS ----------
CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(30) UNIQUE NOT NULL -- admin, placement_officer, company, student
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(150) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role_id INT NOT NULL REFERENCES roles(id),
    is_approved BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    -- V3: token_version is bumped on logout-everywhere, password change, or
    -- an admin disabling the account. The auth middleware checks the JWT's
    -- embedded token_version against this column on every request, so a
    -- revoked/stale token stops working immediately instead of staying
    -- valid until its natural expiry.
    token_version INT NOT NULL DEFAULT 0,
    last_login TIMESTAMP,
    password_changed_at TIMESTAMP DEFAULT now(),
    created_at TIMESTAMP DEFAULT now(),
    updated_at TIMESTAMP DEFAULT now()
);

-- V3: refresh tokens, stored hashed (never plaintext) with rotation —
-- each use issues a new refresh token and revokes this one.
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT now()
);

-- ---------- STUDENTS ----------
CREATE TABLE students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(20),
    department VARCHAR(100),
    cgpa NUMERIC(4,2),
    graduation_year INT,
    photo_url TEXT,
    resume_url TEXT,
    ats_score NUMERIC(5,2),
    created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE education (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    institution VARCHAR(200),
    degree VARCHAR(150),
    field_of_study VARCHAR(150),
    start_year INT,
    end_year INT,
    grade VARCHAR(20)
);

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    title VARCHAR(200),
    description TEXT,
    tech_stack VARCHAR(300),
    project_url TEXT
);

CREATE TABLE experiences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    company_name VARCHAR(150),
    role_title VARCHAR(150),
    start_date DATE,
    end_date DATE,
    description TEXT
);

CREATE TABLE certificates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    title VARCHAR(200),
    issuer VARCHAR(150),
    issue_date DATE,
    credential_url TEXT
);

-- ---------- SKILLS ----------
CREATE TABLE skills (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL
);

CREATE TABLE student_skills (
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    skill_id INT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    proficiency VARCHAR(20) DEFAULT 'intermediate', -- beginner/intermediate/advanced
    PRIMARY KEY (student_id, skill_id)
);

-- ---------- COMPANIES ----------
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_name VARCHAR(200) NOT NULL,
    website VARCHAR(200),
    industry VARCHAR(120),
    logo_url TEXT,
    description TEXT,
    -- V3: company verification workflow, separate from account approval.
    -- Approval (users.is_approved) controls login; verification_status
    -- controls whether the officer has confirmed the company's identity
    -- documents, which is shown as a trust badge to students.
    verification_status VARCHAR(20) DEFAULT 'pending', -- pending/verified/rejected/suspended
    verified_at TIMESTAMP,
    verified_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT now()
);

-- V3: supporting documents a company uploads for verification
-- (registration certificate, GST doc, etc.)
CREATE TABLE company_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    doc_type VARCHAR(50) NOT NULL,
    file_url TEXT NOT NULL,
    uploaded_at TIMESTAMP DEFAULT now()
);

-- ---------- JOBS ----------
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    location VARCHAR(150),
    job_type VARCHAR(30) DEFAULT 'full_time', -- full_time/internship/contract
    min_cgpa NUMERIC(4,2),
    salary_min NUMERIC(12,2),
    salary_max NUMERIC(12,2),
    application_deadline DATE,
    status VARCHAR(20) DEFAULT 'open', -- open/closed
    created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE job_skills (
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    skill_id INT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    is_mandatory BOOLEAN DEFAULT TRUE,
    PRIMARY KEY (job_id, skill_id)
);

-- ---------- APPLICATIONS ----------
-- V3: the pipeline grew from 5 states to the 8-state recruitment pipeline
-- in the V3 blueprint. Valid transitions between these are enforced in
-- server/src/utils/applicationPipeline.js, not just in the UI.
CREATE TABLE applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    status VARCHAR(30) DEFAULT 'applied',
    -- applied / under_review / shortlisted / interview_scheduled /
    -- interview_completed / selected / rejected / on_hold
    match_score NUMERIC(5,2),
    final_salary NUMERIC(12,2), -- filled in when status becomes 'selected'
    status_history JSONB DEFAULT '[]', -- [{status, changed_at, changed_by}]
    applied_at TIMESTAMP DEFAULT now(),
    UNIQUE(student_id, job_id)
);

-- ---------- RESUMES (versioned uploads) ----------
-- V3: resumes are now labeled (e.g. "Java Developer Resume") and one can
-- be marked default, so a student can keep several tailored versions
-- instead of only ever having "the latest one". file_path (server-local,
-- not web-servable) backs the new authenticated download endpoints —
-- file_url is kept for backward compatibility but is no longer served
-- directly by a static file route (see Section on resume security).
CREATE TABLE resumes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    file_url TEXT NOT NULL,
    file_path TEXT,
    label VARCHAR(100) DEFAULT 'General Resume',
    is_default BOOLEAN DEFAULT FALSE,
    parsed_json JSONB,
    ats_score NUMERIC(5,2),
    missing_keywords TEXT[],
    uploaded_at TIMESTAMP DEFAULT now()
);

-- V3: structured entity extraction kept separate from the resume's raw
-- parsed_json blob, so other modules (roadmaps, recommendations) can query
-- specific fields without re-parsing text every time.
CREATE TABLE resume_parsed_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
    full_name VARCHAR(150),
    emails TEXT[],
    phones TEXT[],
    education JSONB DEFAULT '[]',   -- [{degree, institution, cgpa, year}]
    experience JSONB DEFAULT '[]',  -- [{role, company, duration}]
    projects JSONB DEFAULT '[]',    -- [{title, description}]
    certifications JSONB DEFAULT '[]',
    extracted_at TIMESTAMP DEFAULT now()
);

-- V3: every ATS score a resume ever received, against whichever job (or
-- the generic keyword list) it was scored against — powers "see your
-- score improve across versions" in the resume improvement assistant.
CREATE TABLE resume_ats_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resume_id UUID NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    overall_score NUMERIC(5,2),
    breakdown JSONB,
    missing_keywords TEXT[],
    scored_at TIMESTAMP DEFAULT now()
);

-- ---------- INTERVIEWS ----------
CREATE TABLE interviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    scheduled_at TIMESTAMP,
    mode VARCHAR(20) DEFAULT 'online', -- online/offline
    interviewer_name VARCHAR(150),
    status VARCHAR(30) DEFAULT 'scheduled', -- scheduled/completed/cancelled
    created_at TIMESTAMP DEFAULT now()
);

-- V3: real company-interview feedback, broken into the three dimensions
-- the blueprint asks for, instead of one opaque "score".
CREATE TABLE interview_feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    interview_id UUID NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
    technical_rating NUMERIC(3,1),      -- 1-10
    problem_solving_rating NUMERIC(3,1),-- 1-10
    communication_rating NUMERIC(3,1),  -- 1-10
    score NUMERIC(5,2),                 -- overall (avg of the three, scaled) — kept for backward compatibility
    strengths TEXT,
    weaknesses TEXT,
    comments TEXT,
    recommendation VARCHAR(30), -- selected/rejected/on_hold (aliases: hire/reject/hold accepted for backward compat)
    submitted_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT now()
);

-- Mock (AI-generated, self-practice) interviews.
-- V3: tagged with difficulty and the mix of categories requested, so a
-- student can ask for "advanced, mostly technical + project-based".
CREATE TABLE mock_interviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id),
    difficulty VARCHAR(20) DEFAULT 'intermediate', -- beginner/intermediate/advanced
    questions JSONB, -- [{question, category, difficulty}]
    self_score NUMERIC(5,2),
    created_at TIMESTAMP DEFAULT now()
);

-- V3: a student's typed answer to one mock-interview question.
CREATE TABLE interview_answers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    mock_interview_id UUID NOT NULL REFERENCES mock_interviews(id) ON DELETE CASCADE,
    question_index INT NOT NULL,
    question_text TEXT NOT NULL,
    answer_text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT now()
);

-- V3: the AI evaluator's explainable, weighted breakdown of one answer.
CREATE TABLE interview_evaluations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    answer_id UUID NOT NULL REFERENCES interview_answers(id) ON DELETE CASCADE,
    technical_score NUMERIC(5,2),    -- weight 40
    conceptual_score NUMERIC(5,2),   -- weight 25
    explanation_score NUMERIC(5,2),  -- weight 20
    completeness_score NUMERIC(5,2), -- weight 15
    overall_score NUMERIC(5,2),
    feedback JSONB, -- { matched_concepts, missing_concepts, suggestions }
    created_at TIMESTAMP DEFAULT now()
);

-- ---------- NOTIFICATIONS ----------
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200),
    message TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT now()
);

-- ---------- REPORTS / ANALYTICS ----------
CREATE TABLE reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    generated_by UUID REFERENCES users(id),
    report_type VARCHAR(60), -- placement_summary/department_wise/company_wise
    filters JSONB,
    file_url TEXT,
    created_at TIMESTAMP DEFAULT now()
);

-- ---------- ACTIVITY LOGS ----------
CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(200),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT now()
);

-- V3: per-user notification channel preferences. in_app is always on;
-- email_enabled gates whether utils/notify.js also attempts an email
-- (which itself degrades to a harmless console "dry run" log if no SMTP
-- credentials are configured — see Section on email in the README).
CREATE TABLE notification_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email_enabled BOOLEAN DEFAULT TRUE,
    in_app_enabled BOOLEAN DEFAULT TRUE
);

-- ---------- LEARNING ROADMAPS ----------
-- V3: generated from a student's skill gap against a specific job;
-- `steps` is an ordered array the student works through and checks off.
CREATE TABLE learning_roadmaps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    steps JSONB NOT NULL DEFAULT '[]', -- [{skill, resource_name, resource_url, order}]
    created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE learning_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    roadmap_id UUID NOT NULL REFERENCES learning_roadmaps(id) ON DELETE CASCADE,
    step_index INT NOT NULL,
    completed BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMP,
    UNIQUE(roadmap_id, step_index)
);

-- ---------- PLACEMENT DRIVES ----------
-- V3: a placement drive is a recruitment event — one or more companies,
-- one registration window, eligibility criteria, attendance and outcomes
-- tracked per registered student.
CREATE TABLE placement_drives (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    drive_date DATE,
    registration_deadline DATE,
    min_cgpa NUMERIC(4,2),
    eligible_departments TEXT[], -- empty/null = open to all departments
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE drive_companies (
    drive_id UUID NOT NULL REFERENCES placement_drives(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    PRIMARY KEY (drive_id, company_id)
);

CREATE TABLE drive_registrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    drive_id UUID NOT NULL REFERENCES placement_drives(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    registered_at TIMESTAMP DEFAULT now(),
    UNIQUE(drive_id, student_id)
);

CREATE TABLE drive_attendance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    registration_id UUID NOT NULL UNIQUE REFERENCES drive_registrations(id) ON DELETE CASCADE,
    attended BOOLEAN DEFAULT FALSE,
    outcome VARCHAR(30), -- shortlisted/selected/rejected/pending
    marked_at TIMESTAMP DEFAULT now()
);

-- ---------- ALUMNI ----------
-- V3: a simple alumni directory, managed by placement officers/admins
-- (no separate alumni login role, to keep the auth matrix from the V2
-- review simple — this is a directory feature, not a portal).
CREATE TABLE alumni (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(150) NOT NULL,
    graduation_year INT,
    department VARCHAR(100),
    current_organization VARCHAR(200),
    job_role VARCHAR(150),
    industry VARCHAR(120),
    mentorship_available BOOLEAN DEFAULT FALSE,
    contact_email VARCHAR(150),
    linkedin_url TEXT,
    added_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT now()
);

-- ---------- PLACEMENT READINESS / PREDICTION ----------
-- V3: deliberately "method" tagged. The V3 blueprint explicitly warns
-- against fabricating ML accuracy without real historical data, so the
-- live endpoint behind this table uses a transparent RULE-BASED formula
-- (method='rule_based') by default. scripts/train_readiness_model.py
-- ships a trainable scikit-learn pipeline for later, once real placement
-- outcome data exists — its results would be stored here with
-- method='logistic_regression' or similar, never invented.
CREATE TABLE prediction_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    readiness_score NUMERIC(5,2),
    factors JSONB, -- transparent breakdown of what drove the score
    method VARCHAR(30) DEFAULT 'rule_based',
    created_at TIMESTAMP DEFAULT now()
);

-- ---------- SEED DATA ----------
INSERT INTO roles (name) VALUES ('admin'), ('placement_officer'), ('company'), ('student')
ON CONFLICT DO NOTHING;

INSERT INTO skills (name) VALUES
 ('Python'),('JavaScript'),('TypeScript'),('React'),('Node.js'),('Docker'),
 ('Kubernetes'),('AWS'),('SQL'),('Machine Learning'),('REST API'),('Java'),
 ('C++'),('MongoDB'),('PostgreSQL'),('Git'),('Linux'),('Django'),('FastAPI'),('Spring Boot')
ON CONFLICT DO NOTHING;

-- ---------- INDEXES ----------
CREATE INDEX idx_applications_student ON applications(student_id);
CREATE INDEX idx_applications_job ON applications(job_id);
CREATE INDEX idx_jobs_company ON jobs(company_id);
CREATE INDEX idx_students_department ON students(department);
CREATE INDEX idx_notifications_user ON notifications(user_id);

-- V3 indexes — added for the new tables and the query patterns the V3
-- features actually run (status filtering, history lookups, drive
-- rosters, refresh-token lookups on every /auth/refresh call).
CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_resume_ats_history_student ON resume_ats_history(student_id);
CREATE INDEX idx_resume_ats_history_resume ON resume_ats_history(resume_id);
CREATE INDEX idx_resume_parsed_data_resume ON resume_parsed_data(resume_id);
CREATE INDEX idx_interview_answers_mock ON interview_answers(mock_interview_id);
CREATE INDEX idx_company_documents_company ON company_documents(company_id);
CREATE INDEX idx_drive_registrations_student ON drive_registrations(student_id);
CREATE INDEX idx_drive_registrations_drive ON drive_registrations(drive_id);
CREATE INDEX idx_learning_roadmaps_student ON learning_roadmaps(student_id);
CREATE INDEX idx_learning_progress_roadmap ON learning_progress(roadmap_id);
CREATE INDEX idx_alumni_department ON alumni(department);
CREATE INDEX idx_prediction_results_student ON prediction_results(student_id);
CREATE INDEX idx_companies_verification ON companies(verification_status);
