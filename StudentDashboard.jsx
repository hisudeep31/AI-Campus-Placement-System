import { useEffect, useState } from "react";
import api from "../api/axios.js";
import ResumeLink from "../components/ResumeLink.jsx";
import EmptyState from "../components/shared/EmptyState.jsx";
import ReadinessCard from "../components/student/ReadinessCard.jsx";
import DrivesTab from "../components/student/DrivesTab.jsx";
import RoadmapsTab from "../components/student/RoadmapsTab.jsx";
import AlumniPanel from "../components/shared/AlumniPanel.jsx";
import StatCard from "../components/StatCard.jsx";

const TABS = ["Overview", "Profile", "Resume", "Skills", "Skill Gap", "Recommendations", "Applications", "Interviews", "Mock Interview", "Roadmaps", "Drives", "Alumni"];

export default function StudentDashboard() {
  const [tab, setTab] = useState("Overview");
  const [profile, setProfile] = useState(null);
  const [jobs, setJobs] = useState([]);

  const loadProfile = async () => {
    const { data } = await api.get("/students/me");
    setProfile(data);
  };

  const loadJobs = async () => {
    const { data } = await api.get("/jobs");
    setJobs(data);
  };

  useEffect(() => { loadProfile(); loadJobs(); }, []);

  if (!profile) return <div className="max-w-5xl mx-auto px-6 py-10 text-slate">Loading...</div>;

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-display font-semibold mb-1">Hi, {profile.full_name}</h1>
      <p className="text-slate text-sm mb-6">Track your resume score, applications, and interview prep.</p>

      <div className="flex gap-1 border-b border-slate-200 mb-6 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px ${tab === t ? "border-accent text-accent" : "border-transparent text-slate hover:text-ink"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && <Overview profile={profile} />}
      {tab === "Profile" && <ProfileTab profile={profile} onUpdated={loadProfile} />}
      {tab === "Resume" && <ResumeTab profile={profile} jobs={jobs} onUpdated={loadProfile} />}
      {tab === "Skills" && <SkillsTab profile={profile} onUpdated={loadProfile} />}
      {tab === "Skill Gap" && <SkillGapTab jobs={jobs} />}
      {tab === "Recommendations" && <RecommendationsTab />}
      {tab === "Applications" && <ApplicationsTab />}
      {tab === "Interviews" && <InterviewsTab />}
      {tab === "Mock Interview" && <MockInterviewTab jobs={jobs} />}
      {tab === "Roadmaps" && <RoadmapsTab jobs={jobs} />}
      {tab === "Drives" && <DrivesTab />}
      {tab === "Alumni" && <AlumniPanel />}
    </div>
  );
}

function Overview({ profile }) {
  const completionFields = [profile.phone, profile.department, profile.cgpa, profile.graduation_year, profile.resume_url, profile.skills?.length];
  const completionPct = Math.round((completionFields.filter(Boolean).length / completionFields.length) * 100);

  return (
    <div className="space-y-4">
      <ReadinessCard />
      <div className="grid sm:grid-cols-4 gap-4">
        <StatCard label="ATS Score" value={profile.ats_score ? `${profile.ats_score}%` : "—"} accent />
        <StatCard label="CGPA" value={profile.cgpa || "—"} />
        <StatCard label="Skills listed" value={profile.skills?.length || 0} />
        <StatCard label="Profile complete" value={`${completionPct}%`} />
      </div>
      {completionPct < 100 && (
        <div className="card bg-warn/5 border-warn/20">
          <p className="text-sm">
            Your profile is {completionPct}% complete. Fill in your Profile, Skills, and Resume tabs
            to get better job recommendations and placement readiness.
          </p>
        </div>
      )}
    </div>
  );
}

function ProfileTab({ profile, onUpdated }) {
  const [form, setForm] = useState({
    full_name: profile.full_name || "",
    phone: profile.phone || "",
    department: profile.department || "",
    cgpa: profile.cgpa || "",
    graduation_year: profile.graduation_year || "",
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await api.put("/students/me", form);
      setMessage("Profile updated.");
      onUpdated();
    } catch (err) {
      setError(err.response?.data?.error || "Could not update profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-4 max-w-lg">
      <h3 className="font-semibold">Your profile</h3>
      {message && <p className="text-sm text-accentDark bg-accent/10 rounded-lg px-3 py-2">{message}</p>}
      {error && <p className="text-danger text-sm">{error}</p>}
      <div>
        <label className="text-sm font-medium">Full name</label>
        <input className="input-field mt-1" value={form.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium">Phone</label>
        <input className="input-field mt-1" value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium">Department</label>
        <input className="input-field mt-1" placeholder="e.g. Computer Science" value={form.department}
          onChange={(e) => setForm({ ...form, department: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">CGPA (0–10)</label>
          <input type="number" step="0.01" min="0" max="10" className="input-field mt-1" value={form.cgpa}
            onChange={(e) => setForm({ ...form, cgpa: e.target.value })} />
        </div>
        <div>
          <label className="text-sm font-medium">Graduation year</label>
          <input type="number" className="input-field mt-1" value={form.graduation_year}
            onChange={(e) => setForm({ ...form, graduation_year: e.target.value })} />
        </div>
      </div>
      <button className="btn-primary" disabled={saving}>{saving ? "Saving..." : "Save profile"}</button>
    </form>
  );
}

function ResumeTab({ profile, jobs, onUpdated }) {
  const [file, setFile] = useState(null);
  const [jobId, setJobId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);

  const loadHistory = async () => {
    try {
      const { data } = await api.get("/students/me/resumes");
      setHistory(data);
    } catch {
      // non-fatal — history is a nice-to-have
    }
  };

  useEffect(() => { loadHistory(); }, []);

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("resume", file);
      if (jobId) form.append("job_id", jobId);
      const { data } = await api.post("/students/me/resume", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(data);
      onUpdated();
      loadHistory();
    } catch (err) {
      setError(err.response?.data?.error || "Upload failed. Is the AI service running?");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <h3 className="font-semibold mb-2">Upload resume (PDF)</h3>
        <p className="text-sm text-slate mb-3">
          Optionally pick a job below to get an ATS score scored against that
          job's specific required skills instead of a generic keyword list.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files[0])}
            className="text-sm" />
          <select className="input-field sm:max-w-xs" value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">Score against generic keywords</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.title} — {j.company_name}</option>
            ))}
          </select>
          <button className="btn-primary whitespace-nowrap" onClick={upload} disabled={!file || uploading}>
            {uploading ? "Analyzing..." : "Upload & Analyze"}
          </button>
        </div>
        {error && <p className="text-danger text-sm mt-3">{error}</p>}
      </div>

      {profile.resume_url && (
        <p className="text-sm">
          Current resume:{" "}
          <ResumeLink resumeId={profile.resume_id} className="text-accent font-medium">View uploaded PDF</ResumeLink>
        </p>
      )}

      {(result || profile.ats_score) && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">ATS Score</h3>
            {result?.scored_against_job && (
              <span className="badge bg-accent/10 text-accentDark">Scored against selected job</span>
            )}
          </div>
          <p className="text-4xl font-display font-semibold text-accent">
            {result ? result.ats_score : profile.ats_score}%
          </p>
          {result?.score_breakdown && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
              {Object.entries(result.score_breakdown).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-slate/10 p-3" title={v.evidence}>
                  <p className="text-lg font-semibold">{v.score}<span className="text-xs text-slate"> / {v.max}</span></p>
                  <p className="text-xs text-slate capitalize">{k.replace("_", " ")}</p>
                  <p className="text-[11px] text-slate/80 mt-1 leading-snug">{v.evidence}</p>
                </div>
              ))}
            </div>
          )}
          {result?.missing_keywords?.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium mb-1">Missing keywords</p>
              <div className="flex flex-wrap gap-1.5">
                {result.missing_keywords.map((k) => (
                  <span key={k} className="badge bg-warn/10 text-warn border border-warn/30">{k}</span>
                ))}
              </div>
            </div>
          )}
          {result?.suggestions?.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium mb-1">Suggestions</p>
              <ul className="text-sm text-slate space-y-1 list-disc list-inside">
                {result.suggestions.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="card">
          <h3 className="font-semibold mb-3">Upload history</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate border-b border-slate-200">
                  <th className="py-2 pr-4">Uploaded</th>
                  <th className="py-2 pr-4">ATS score</th>
                  <th className="py-2">Resume</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-4 text-slate">{new Date(h.uploaded_at).toLocaleString()}</td>
                    <td className="py-2 pr-4 font-medium">{h.ats_score != null ? `${h.ats_score}%` : "—"}</td>
                    <td className="py-2">
                      <a href={h.file_url} target="_blank" rel="noreferrer" className="text-accent font-medium">View</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function SkillsTab({ profile, onUpdated }) {
  const [skillInput, setSkillInput] = useState("");
  const [skills, setSkills] = useState(profile.skills?.map((s) => s.name) || []);
  const [saving, setSaving] = useState(false);

  const addSkill = () => {
    if (skillInput.trim() && !skills.includes(skillInput.trim())) {
      setSkills([...skills, skillInput.trim()]);
      setSkillInput("");
    }
  };

  
const save = async () => {
  setSaving(true);

  try {
    await api.put("/students/me/skills", {
      skills: skills.map((name) => ({
        name: name.trim(),
        proficiency: "intermediate"
      }))
    });

    await onUpdated();
    alert("Skills saved successfully!");
  } catch (err) {
    console.error("Skills save error:", err);

    alert(
      err.response?.data?.error ||
      err.response?.data?.message ||
      "Failed to save skills. Check the backend logs."
    );
  } finally {
    setSaving(false);
  }
};


  return (
    <div className="card">
      <h3 className="font-semibold mb-3">Your skills</h3>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {skills.map((s) => (
          <span key={s} className="badge bg-accent/10 text-accentDark flex items-center gap-1">
            {s}
            <button onClick={() => setSkills(skills.filter((x) => x !== s))} className="text-accentDark/60">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2 mb-4">
        <input className="input-field" placeholder="e.g. Docker"
          value={skillInput} onChange={(e) => setSkillInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addSkill()} />
        <button className="btn-secondary" onClick={addSkill}>Add</button>
      </div>
      <button className="btn-primary" onClick={save} disabled={saving}>
        {saving ? "Saving..." : "Save skills"}
      </button>
    </div>
  );
}

function SkillGapTab({ jobs }) {
  const [jobId, setJobId] = useState("");
  const [gap, setGap] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const check = async () => {
    if (!jobId) return;
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/students/me/skill-gap", { params: { job_id: jobId } });
      setGap(data);
    } catch (err) {
      setError(err.response?.data?.error || "Could not compute skill gap");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="font-semibold mb-3">Check your skill gap for a job</h3>
        <div className="flex gap-2">
          <select className="input-field" value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">Select a job...</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.title} — {j.company_name}</option>
            ))}
          </select>
          <button className="btn-primary whitespace-nowrap" onClick={check} disabled={!jobId || loading}>
            {loading ? "Checking..." : "Check gap"}
          </button>
        </div>
        {error && <p className="text-danger text-sm mt-3">{error}</p>}
      </div>

      {gap && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-semibold">Match: {gap.match_percent}%</h4>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium mb-2">You have</p>
              <div className="flex flex-wrap gap-1.5">
                {gap.have.length ? gap.have.map((s) => (
                  <span key={s} className="badge bg-green-100 text-green-700">{s}</span>
                )) : <p className="text-sm text-slate">No overlapping skills listed yet.</p>}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Missing — recommended to learn</p>
              <div className="flex flex-wrap gap-1.5">
                {gap.missing.length ? gap.missing.map((s) => (
                  <span key={s} className="badge bg-warn/10 text-warn border border-warn/30">{s}</span>
                )) : <p className="text-sm text-slate">You meet all required skills!</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function RecommendationsTab() {
  const [recs, setRecs] = useState(null);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(null);
  const [message, setMessage] = useState("");

  const loadRecommendations = async () => {
    try {
      setError("");
      const { data } = await api.get("/students/me/recommendations");
      setRecs(data);
    } catch (err) {
      setError(
        err.response?.data?.error ||
        "Could not load recommendations."
      );
    }
  };

  useEffect(() => {
    loadRecommendations();
  }, []);

  const apply = async (jobId) => {
    setApplying(jobId);
    setMessage("");

    try {
      await api.post(`/jobs/${jobId}/apply`);

      setRecs((current) =>
        current.filter((job) => job.id !== jobId)
      );

      setMessage("Application submitted successfully!");
    } catch (err) {
      setMessage(
        err.response?.data?.error || "Could not apply."
      );
    } finally {
      setApplying(null);
    }
  };

  if (error) {
    return <p className="text-danger">{error}</p>;
  }

  if (recs === null) {
    return <p>Loading recommendations...</p>;
  }

  return (
    <div className="grid gap-3">

      {message && (
        <p className="text-sm text-accentDark bg-accent/10 p-3 rounded-lg">
          {message}
        </p>
      )}

      {recs.map((job) => (
        <div
          key={job.id}
          className="card flex items-center justify-between gap-4"
        >
          <div>
            <h4 className="font-semibold">{job.title}</h4>

            <p className="text-sm text-slate">
              {job.company_name || "Company"}
            </p>

            <p className="text-sm mt-1">
              {job.description}
            </p>

            {job.reasons?.map((reason, index) => (
              <p key={index} className="text-xs text-slate mt-1">
                {reason}
              </p>
            ))}
          </div>

          <div className="flex flex-col items-end gap-2">
            <span className="badge bg-accent/10 text-accentDark">
              {Math.round(job.similarity_score * 100)}% match
            </span>

            <button
              className="btn-primary whitespace-nowrap"
              disabled={applying === job.id}
              onClick={() => apply(job.id)}
            >
              {applying === job.id ? "Applying..." : "Apply"}
            </button>
          </div>
        </div>
      ))}

      {recs.length === 0 && (
        <p className="text-slate text-sm">
          No eligible jobs available right now.
          Check back when new jobs are posted.
        </p>
      )}
    </div>
  );
}


function ApplicationsTab() {
  const [apps, setApps] = useState([]);

  useEffect(() => {
    api.get("/students/me/applications").then(({ data }) => setApps(data));
  }, []);

  const statusColor = {
    applied: "bg-slate-100 text-slate",
    shortlisted: "bg-accent/10 text-accentDark",
    interview_scheduled: "bg-warn/10 text-warn",
    selected: "bg-green-100 text-green-700",
    under_review: "bg-blue-100 text-blue-700",
    interview_completed: "bg-indigo-100 text-indigo-700",
    on_hold: "bg-amber-100 text-amber-700",
    rejected: "bg-red-100 text-danger",
  };

  return (
    <div className="grid gap-3">
      {apps.map((a) => (
        <div key={a.id} className="card flex items-center justify-between">
          <div>
            <h4 className="font-semibold">{a.title}</h4>
            <p className="text-sm text-slate">{a.company_name}</p>
          </div>
          <span className={`badge ${statusColor[a.status] || "bg-slate-100"} capitalize`}>
            {a.status.replace("_", " ")}
          </span>
        </div>
      ))}
      {!apps.length && <p className="text-slate text-sm">You haven't applied to any jobs yet.</p>}
    </div>
  );
}

function InterviewsTab() {
  const [interviews, setInterviews] = useState([]);

  useEffect(() => {
    api.get("/students/me/interviews").then(({ data }) => setInterviews(data));
  }, []);

  const now = new Date();

  const downloadIcs = async () => {
    const res = await api.get("/students/me/interviews/calendar.ics", { responseType: "blob" });
    const url = URL.createObjectURL(new Blob([res.data], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url; a.download = "interviews.ics"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-3">
      {interviews.length > 0 && (
        <div className="text-right"><button className="btn-secondary text-xs" onClick={downloadIcs}>Add upcoming to calendar (.ics)</button></div>
      )}
      {interviews.map((i) => {
        const isPast = new Date(i.scheduled_at) < now;
        return (
          <div key={i.id} className="card flex items-center justify-between">
            <div>
              <h4 className="font-semibold">{i.job_title}</h4>
              <p className="text-sm text-slate">{i.company_name} · {i.mode} · {i.interviewer_name || "Interviewer TBD"}</p>
              <p className="text-sm mt-1">{new Date(i.scheduled_at).toLocaleString()}</p>
            </div>
            <span className={`badge ${isPast ? "bg-slate-100 text-slate" : "bg-accent/10 text-accentDark"}`}>
              {isPast ? "Past" : "Upcoming"}
            </span>
          </div>
        );
      })}
      {!interviews.length && <EmptyState title="No interviews scheduled yet" hint="Once a company schedules one, it shows up here and in your notifications." />}
    </div>
  );
}

function MockInterviewTab({ jobs }) {
  const [jobId, setJobId] = useState("");
  const [difficulty, setDifficulty] = useState("intermediate");
  const [mock, setMock] = useState(null);
  const [answers, setAnswers] = useState({});
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState(false);
  const [busyIdx, setBusyIdx] = useState(null);
  const [error, setError] = useState("");

  const asQuestions = (m) => (typeof m.questions === "string" ? JSON.parse(m.questions) : m.questions) || [];

  const generate = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post("/students/me/mock-interview", { job_id: jobId || undefined, difficulty });
      setMock(data);
      setAnswers({});
      setResults({});
    } catch (err) {
      setError(err.response?.data?.error || "Could not generate questions. Is the AI service running?");
    } finally {
      setLoading(false);
    }
  };

  const submit = async (idx) => {
    setBusyIdx(idx);
    setError("");
    try {
      const { data } = await api.post(`/students/me/mock-interview/${mock.id}/answers`, {
        question_index: idx,
        answer_text: answers[idx] || "",
      });
      setResults((r) => ({ ...r, [idx]: data }));
    } catch (err) {
      setError(err.response?.data?.error || "Could not evaluate that answer.");
    } finally {
      setBusyIdx(null);
    }
  };

  const questions = mock ? asQuestions(mock) : null;
  const scored = Object.values(results);
  const avg = scored.length ? Math.round(scored.reduce((a, r) => a + Number(r.overall_score), 0) / scored.length) : null;

  return (
    <div className="card">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <h3 className="font-semibold">AI mock interview</h3>
        <div className="flex flex-wrap gap-2">
          <select className="input-field sm:max-w-xs" value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">Based on your skills only</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.title} — {j.company_name}</option>
            ))}
          </select>
          <select className="input-field sm:max-w-[10rem]" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
          <button className="btn-primary whitespace-nowrap" onClick={generate} disabled={loading}>
            {loading ? "Generating..." : "Generate questions"}
          </button>
        </div>
      </div>
      {error && <p className="text-danger text-sm mb-2">{error}</p>}
      {avg !== null && (
        <p className="text-sm mb-3">Average score so far: <span className="font-semibold text-accent">{avg}/100</span>
          <span className="text-slate"> ({scored.length}/{questions.length} answered)</span></p>
      )}
      {questions && (
        <ol className="space-y-5 text-sm">
          {questions.map((q, i) => {
            const text = typeof q === "string" ? q : q.question;
            const r = results[i];
            return (
              <li key={i} className="border-b border-slate/10 pb-4">
                <p className="font-medium">{i + 1}. {text}</p>
                {typeof q !== "string" && (
                  <p className="mt-1 flex gap-2">
                    <span className="badge capitalize">{q.category}</span>
                    <span className="badge capitalize">{q.difficulty}</span>
                  </p>
                )}
                <textarea
                  className="input-field mt-2 w-full" rows={3} placeholder="Type your answer..."
                  value={answers[i] || ""} onChange={(e) => setAnswers({ ...answers, [i]: e.target.value })}
                />
                <button className="btn-secondary mt-2" disabled={busyIdx === i || !(answers[i] || "").trim()} onClick={() => submit(i)}>
                  {busyIdx === i ? "Evaluating..." : r ? "Re-evaluate" : "Get feedback"}
                </button>
                {r && (
                  <div className="mt-3 rounded-lg bg-slate/5 p-3">
                    <p className="font-semibold">Score: {Math.round(r.overall_score)}/100</p>
                    <p className="text-xs text-slate mt-1">
                      Technical {Math.round(r.technical_score)} · Concepts {Math.round(r.conceptual_score)} ·
                      Explanation {Math.round(r.explanation_score)} · Completeness {Math.round(r.completeness_score)}
                    </p>
                    {r.feedback?.strengths?.map((t, k) => <p key={k} className="text-xs mt-1 text-accentDark">+ {t}</p>)}
                    {r.feedback?.improvements?.map((t, k) => <p key={k} className="text-xs mt-1 text-warn">– {t}</p>)}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <p className="text-[11px] text-slate mt-4">Scores are a transparent practice aid based on concept coverage and answer structure — not a hiring judgement.</p>
    </div>
  );
}
