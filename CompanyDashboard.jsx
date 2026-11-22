import { useEffect, useState } from "react";
import api from "../api/axios.js";
import ResumeLink from "../components/ResumeLink.jsx";
import { useToast } from "../components/shared/Toast.jsx";
import { useConfirm } from "../components/shared/ConfirmDialog.jsx";
import EmptyState from "../components/shared/EmptyState.jsx";
import InsightsTab from "../components/company/InsightsTab.jsx";

const TABS = ["My Jobs", "Post a Job", "Insights", "Company Profile"];

export default function CompanyDashboard() {
  const [tab, setTab] = useState("My Jobs");
  const [jobs, setJobs] = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);

  const loadJobs = async () => {
    const { data } = await api.get("/companies/jobs");
    setJobs(data);
  };

  useEffect(() => { loadJobs(); }, []);

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-display font-semibold mb-1">Company dashboard</h1>
      <p className="text-slate text-sm mb-6">Post roles and manage applicants.</p>

      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {TABS.map((t) => (
          <button key={t} onClick={() => { setTab(t); setSelectedJob(null); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? "border-accent text-accent" : "border-transparent text-slate hover:text-ink"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Post a Job" && <PostJobForm onCreated={() => { loadJobs(); setTab("My Jobs"); }} />}
      {tab === "Company Profile" && <CompanyProfileTab />}
      {tab === "Insights" && <InsightsTab />}

      {tab === "My Jobs" && !selectedJob && (
        <div className="grid gap-3">
          {jobs.map((j) => (
            <div key={j.id} className="card flex items-center justify-between gap-4">
              <button onClick={() => setSelectedJob(j)} className="text-left flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold">{j.title}</h4>
                  <span className={`badge ${j.status === "open" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate"}`}>
                    {j.status}
                  </span>
                </div>
                <p className="text-sm text-slate">{j.location || "Remote"} · {j.job_type?.replace("_", " ")}</p>
              </button>
              <span className="badge bg-accent/10 text-accentDark whitespace-nowrap">{j.applicant_count} applicants</span>
              <ToggleJobStatus job={j} onChanged={loadJobs} />
            </div>
          ))}
          {!jobs.length && <p className="text-slate text-sm">You haven't posted any jobs yet.</p>}
        </div>
      )}

      {tab === "My Jobs" && selectedJob && (
        <ApplicantsPanel job={selectedJob} onBack={() => setSelectedJob(null)} />
      )}
    </div>
  );
}

function ToggleJobStatus({ job, onChanged }) {
  const [saving, setSaving] = useState(false);
  const toggle = async () => {
    setSaving(true);
    try {
      await api.patch(`/companies/jobs/${job.id}`, { status: job.status === "open" ? "closed" : "open" });
      onChanged();
    } finally {
      setSaving(false);
    }
  };
  return (
    <button className="btn-secondary whitespace-nowrap" onClick={toggle} disabled={saving}>
      {job.status === "open" ? "Close" : "Reopen"}
    </button>
  );
}

function CompanyProfileTab() {
  const [form, setForm] = useState({ company_name: "", website: "", industry: "", description: "" });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/companies/me").then(({ data }) => {
      setForm({
        company_name: data.company_name || "",
        website: data.website || "",
        industry: data.industry || "",
        description: data.description || "",
      });
      setLoaded(true);
    });
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await api.put("/companies/me", form);
      setMessage("Company profile updated.");
    } catch (err) {
      setError(err.response?.data?.error || "Could not update profile");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <p className="text-slate text-sm">Loading...</p>;

  return (
    <form onSubmit={submit} className="card space-y-4 max-w-lg">
      <h3 className="font-semibold">Company profile</h3>
      {message && <p className="text-sm text-accentDark bg-accent/10 rounded-lg px-3 py-2">{message}</p>}
      {error && <p className="text-danger text-sm">{error}</p>}
      <div>
        <label className="text-sm font-medium">Company name</label>
        <input required className="input-field mt-1" value={form.company_name}
          onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium">Website</label>
        <input className="input-field mt-1" placeholder="https://..." value={form.website}
          onChange={(e) => setForm({ ...form, website: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium">Industry</label>
        <input className="input-field mt-1" placeholder="e.g. Fintech" value={form.industry}
          onChange={(e) => setForm({ ...form, industry: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium">Description</label>
        <textarea rows={4} className="input-field mt-1" value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>
      <button className="btn-primary" disabled={saving}>{saving ? "Saving..." : "Save profile"}</button>
    </form>
  );
}

function PostJobForm({ onCreated }) {
  const [form, setForm] = useState({
    title: "", description: "", location: "", job_type: "full_time",
    min_cgpa: "", salary_min: "", salary_max: "", application_deadline: "",
  });
  const [skillInput, setSkillInput] = useState("");
  const [skills, setSkills] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const addSkill = () => {
    if (skillInput.trim() && !skills.includes(skillInput.trim())) {
      setSkills([...skills, skillInput.trim()]);
      setSkillInput("");
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post("/companies/jobs", {
        ...form,
        min_cgpa: form.min_cgpa || null,
        salary_min: form.salary_min || null,
        salary_max: form.salary_max || null,
        application_deadline: form.application_deadline || null,
        skills: skills.map((name) => ({ name, is_mandatory: true })),
      });
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || "Could not create job");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-4 max-w-2xl">
      {error && <p className="text-danger text-sm">{error}</p>}
      <div>
        <label className="text-sm font-medium">Job title</label>
        <input required className="input-field mt-1" value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium">Description</label>
        <textarea required rows={4} className="input-field mt-1" value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">Location</label>
          <input className="input-field mt-1" value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </div>
        <div>
          <label className="text-sm font-medium">Job type</label>
          <select className="input-field mt-1" value={form.job_type}
            onChange={(e) => setForm({ ...form, job_type: e.target.value })}>
            <option value="full_time">Full-time</option>
            <option value="internship">Internship</option>
            <option value="contract">Contract</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium">Min CGPA</label>
          <input type="number" step="0.1" className="input-field mt-1" value={form.min_cgpa}
            onChange={(e) => setForm({ ...form, min_cgpa: e.target.value })} />
        </div>
        <div>
          <label className="text-sm font-medium">Application deadline</label>
          <input type="date" className="input-field mt-1" value={form.application_deadline}
            onChange={(e) => setForm({ ...form, application_deadline: e.target.value })} />
        </div>
        <div>
          <label className="text-sm font-medium">Salary min</label>
          <input type="number" className="input-field mt-1" value={form.salary_min}
            onChange={(e) => setForm({ ...form, salary_min: e.target.value })} />
        </div>
        <div>
          <label className="text-sm font-medium">Salary max</label>
          <input type="number" className="input-field mt-1" value={form.salary_max}
            onChange={(e) => setForm({ ...form, salary_max: e.target.value })} />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium">Required skills</label>
        <div className="flex flex-wrap gap-1.5 my-2">
          {skills.map((s) => (
            <span key={s} className="badge bg-accent/10 text-accentDark flex items-center gap-1">
              {s}
              <button type="button" onClick={() => setSkills(skills.filter((x) => x !== s))} className="text-accentDark/60">×</button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input className="input-field" placeholder="e.g. React" value={skillInput}
            onChange={(e) => setSkillInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSkill(); } }} />
          <button type="button" className="btn-secondary" onClick={addSkill}>Add</button>
        </div>
      </div>
      <button className="btn-primary" disabled={saving}>{saving ? "Posting..." : "Post job"}</button>
    </form>
  );
}

function ApplicantsPanel({ job, onBack }) {
  const [applicants, setApplicants] = useState([]);
  const [schedulingFor, setSchedulingFor] = useState(null);
  const [feedbackFor, setFeedbackFor] = useState(null);
  const [actionError, setActionError] = useState("");
  const toast = useToast();
  const confirm = useConfirm();

  const load = async () => {
    const { data } = await api.get(`/companies/jobs/${job.id}/applicants`);
    setApplicants(data);
  };

  useEffect(() => { load(); }, [job.id]);

  const updateStatus = async (applicationId, status) => {
    setActionError("");
    if (status === "rejected" && !(await confirm({
      title: "Reject this candidate?",
      message: "Rejection is final — the application cannot be reopened.",
      confirmLabel: "Reject", danger: true,
    }))) return;
    try {
      const body = { status };
      if (status === "selected") {
        const salary = window.prompt("Offered salary (optional, annual):");
        if (salary) body.final_salary = Number(salary);
      }
      await api.patch(`/companies/applications/${applicationId}`, body);
      toast.success(`Moved to ${status.replace(/_/g, " ")}`);
    } catch (err) {
      setActionError(err.response?.data?.error || "Could not update status");
      toast.error(err.response?.data?.error || "Could not update status");
    }
    load();
  };

  // Moves driven by dedicated actions rather than the dropdown.
  const dropdownMoves = (a) => (a.allowed_next || []).filter((s) => !["interview_scheduled", "interview_completed"].includes(s));

  return (
    <div>
      <button onClick={onBack} className="text-sm text-accent mb-4">&larr; Back to jobs</button>
      <h3 className="font-semibold mb-4">{job.title} — Applicants</h3>
      {actionError && <p className="text-danger text-sm mb-3">{actionError}</p>}
      <div className="grid gap-3">
        {applicants.map((a) => (
          <div key={a.application_id} className="card">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h4 className="font-semibold">{a.full_name}</h4>
                <p className="text-sm text-slate">
                  {a.department} · CGPA {a.cgpa || "—"} · ATS {a.ats_score || "—"}%
                </p>
                <p className="text-sm text-slate">{a.student_email}</p>
                <ResumeLink resumeId={a.resume_id} />
              </div>
              <div className="flex gap-2 items-center flex-wrap">
                <span className="badge capitalize">{a.status.replace(/_/g, " ")}</span>
                {dropdownMoves(a).length > 0 && (
                  <select
                    className="input-field w-auto"
                    value=""
                    onChange={(e) => e.target.value && updateStatus(a.application_id, e.target.value)}
                  >
                    <option value="">Move to...</option>
                    {dropdownMoves(a).map((st) => (
                      <option key={st} value={st}>{st.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                )}
                {(a.allowed_next || []).includes("interview_scheduled") && (
                  <button
                    className="btn-secondary whitespace-nowrap"
                    onClick={() => setSchedulingFor(schedulingFor === a.application_id ? null : a.application_id)}
                  >
                    {a.status === "interview_scheduled" ? "Reschedule" : "Schedule interview"}
                  </button>
                )}
                {a.status === "interview_scheduled" && a.latest_interview_id && !a.has_feedback && (
                  <button
                    className="btn-primary whitespace-nowrap"
                    onClick={() => setFeedbackFor(feedbackFor === a.latest_interview_id ? null : a.latest_interview_id)}
                  >
                    Submit feedback
                  </button>
                )}
              </div>
            </div>
            {feedbackFor && feedbackFor === a.latest_interview_id && (
              <InterviewFeedbackForm
                interviewId={a.latest_interview_id}
                onDone={() => { setFeedbackFor(null); load(); }}
              />
            )}
            {schedulingFor === a.application_id && (
              <ScheduleInterviewForm
                applicationId={a.application_id}
                onDone={() => { setSchedulingFor(null); load(); }}
              />
            )}
          </div>
        ))}
        {!applicants.length && <EmptyState title="No applicants yet" hint="Applicants appear here, ranked by AI match score, as soon as students apply." />}
      </div>
    </div>
  );
}

function ScheduleInterviewForm({ applicationId, onDone }) {
  const [form, setForm] = useState({ scheduled_at: "", mode: "online", interviewer_name: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post(`/companies/applications/${applicationId}/interview`, form);
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || "Could not schedule interview");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-2 items-end">
      {error && <p className="text-danger text-sm w-full">{error}</p>}
      <div>
        <label className="text-xs font-medium block mb-1">Date & time</label>
        <input required type="datetime-local" className="input-field" value={form.scheduled_at}
          onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
      </div>
      <div>
        <label className="text-xs font-medium block mb-1">Mode</label>
        <select className="input-field" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
        </select>
      </div>
      <div>
        <label className="text-xs font-medium block mb-1">Interviewer</label>
        <input className="input-field" placeholder="Name" value={form.interviewer_name}
          onChange={(e) => setForm({ ...form, interviewer_name: e.target.value })} />
      </div>
      <button className="btn-primary" disabled={saving}>{saving ? "Scheduling..." : "Confirm"}</button>
    </form>
  );
}

function InterviewFeedbackForm({ interviewId, onDone }) {
  const [form, setForm] = useState({
    technical_rating: 7, problem_solving_rating: 7, communication_rating: 7,
    strengths: "", weaknesses: "", comments: "", recommendation: "on_hold",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post(`/companies/interviews/${interviewId}/feedback`, form);
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || "Could not submit feedback");
    } finally {
      setSaving(false);
    }
  };

  const rating = (key, label) => (
    <label className="text-sm">
      {label}: <span className="font-semibold">{form[key]}</span>/10
      <input type="range" min="1" max="10" className="w-full" value={form[key]}
        onChange={(e) => set(key, Number(e.target.value))} />
    </label>
  );

  return (
    <form onSubmit={submit} className="mt-4 pt-4 border-t border-slate/10 grid gap-3">
      <div className="grid sm:grid-cols-3 gap-4">
        {rating("technical_rating", "Technical")}
        {rating("problem_solving_rating", "Problem solving")}
        {rating("communication_rating", "Communication")}
      </div>
      <input className="input-field" placeholder="Strengths" value={form.strengths} onChange={(e) => set("strengths", e.target.value)} />
      <input className="input-field" placeholder="Weaknesses" value={form.weaknesses} onChange={(e) => set("weaknesses", e.target.value)} />
      <textarea className="input-field" rows={2} placeholder="Comments" value={form.comments} onChange={(e) => set("comments", e.target.value)} />
      <div className="flex items-center gap-3 flex-wrap">
        <select className="input-field w-auto" value={form.recommendation} onChange={(e) => set("recommendation", e.target.value)}>
          <option value="selected">Recommend: select</option>
          <option value="on_hold">Recommend: hold</option>
          <option value="rejected">Recommend: reject</option>
        </select>
        <button className="btn-primary" disabled={saving}>{saving ? "Saving..." : "Submit feedback"}</button>
        {error && <span className="text-danger text-sm">{error}</span>}
      </div>
    </form>
  );
}
