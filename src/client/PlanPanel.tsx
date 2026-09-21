import { useState, type FormEvent } from "react";
import { LIMITS, type AgentState, type JobStep } from "../shared/types";
import { startAnalysis } from "./api";
import { SAMPLE_BACKGROUND, SAMPLE_JD } from "./sample";

export function PlanPanel({ session, state }: { session: string; state: AgentState }) {
  const [editing, setEditing] = useState(false);
  const { plan, job } = state;
  const showForm = !plan || editing;

  return (
    <section className="panel plan-panel" aria-label="Prep plan">
      {job.status === "running" ? (
        <Progress steps={job.steps} />
      ) : showForm ? (
        <PlanForm
          session={session}
          jobError={job.status === "error" ? job.error : undefined}
          onCancel={plan ? () => setEditing(false) : undefined}
          onStarted={() => setEditing(false)}
        />
      ) : (
        plan && <PlanView state={state} onNew={() => setEditing(true)} />
      )}
    </section>
  );
}

function PlanForm(props: { session: string; jobError?: string; onCancel?: () => void; onStarted: () => void }) {
  const [jd, setJd] = useState("");
  const [background, setBackground] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = jd.trim().length < LIMITS.jobDescriptionMin;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (tooShort) {
      setError(`Paste the full job description (at least ${LIMITS.jobDescriptionMin} characters).`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await startAnalysis(props.session, jd, background);
      props.onStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="plan-form" onSubmit={submit} noValidate>
      <div className="panel-head">
        <h2>New prep plan</h2>
        <p className="muted">
          Paste a job description. An agent workflow reads it, maps your gaps and writes a tailored mock interview.
        </p>
      </div>

      {props.jobError && (
        <div className="alert error" role="alert">
          <strong>The last plan didn't finish.</strong> {props.jobError}
        </div>
      )}

      <label className="field">
        <span className="field-label">
          Job description <span className="req">required</span>
        </span>
        <textarea
          value={jd}
          onChange={(e) => setJd(e.target.value)}
          maxLength={LIMITS.jobDescriptionMax}
          rows={9}
          placeholder="Paste the role's responsibilities and requirements…"
          aria-invalid={!!error && tooShort}
        />
        <span className="field-hint">
          {jd.length.toLocaleString()} / {LIMITS.jobDescriptionMax.toLocaleString()}
        </span>
      </label>

      <label className="field">
        <span className="field-label">
          Your background <span className="opt">optional</span>
        </span>
        <textarea
          value={background}
          onChange={(e) => setBackground(e.target.value)}
          maxLength={LIMITS.backgroundMax}
          rows={4}
          placeholder="A few lines about your experience. Sharper gap analysis if you add it."
        />
      </label>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={submitting}>
          {submitting ? "Starting…" : "Build prep plan"}
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            setJd(SAMPLE_JD);
            setBackground(SAMPLE_BACKGROUND);
            setError(null);
          }}
        >
          Use a sample
        </button>
        {props.onCancel && (
          <button type="button" className="btn ghost" onClick={props.onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

const STATUS_LABEL: Record<JobStep["status"], string> = {
  pending: "Waiting",
  running: "In progress",
  done: "Done",
  error: "Failed",
};

function Progress({ steps }: { steps: JobStep[] }) {
  const done = steps.filter((s) => s.status === "done").length;
  return (
    <div className="progress" aria-live="polite">
      <div className="panel-head">
        <h2>Building your plan</h2>
        <p className="muted">
          Running as a durable Cloudflare Workflow. Each step is checkpointed and retried on failure. You can refresh the
          page and it keeps going.
        </p>
      </div>
      <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}>
        <span style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.id} className={`step ${s.status}`}>
            <span className="step-icon" aria-hidden="true">
              {s.status === "done" ? "✓" : s.status === "error" ? "!" : i + 1}
            </span>
            <span className="step-label">{s.label}</span>
            <span className="step-status">{STATUS_LABEL[s.status]}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PlanView({ state, onNew }: { state: AgentState; onNew: () => void }) {
  const plan = state.plan!;
  const scoreFor = (id: string) => state.scores.find((s) => s.questionId === id);
  const answered = state.scores.length;
  const avg = answered ? state.scores.reduce((a, s) => a + s.score, 0) / answered : null;

  return (
    <div className="plan-view">
      <div className="panel-head">
        <p className="eyebrow">
          {plan.profile.company !== "Unknown" ? plan.profile.company : "Target role"} · {plan.profile.seniority}
        </p>
        <h2>{plan.profile.role}</h2>
        <p className="muted">{plan.profile.summary}</p>
      </div>

      <div className="stats">
        <div>
          <span className="stat-value">
            {answered}/{plan.questions.length}
          </span>
          <span className="stat-label">answered</span>
        </div>
        <div>
          <span className="stat-value">{avg === null ? "–" : avg.toFixed(1)}</span>
          <span className="stat-label">avg score / 5</span>
        </div>
      </div>

      <details open>
        <summary>Competencies</summary>
        <ul className="competencies">
          {plan.profile.competencies.map((c) => (
            <li key={c.name} title={c.why}>
              <span>{c.name}</span>
              <span className="weight" aria-label={`weight ${c.weight} of 5`}>
                {Array.from({ length: 5 }, (_, i) => (
                  <i key={i} className={i < c.weight ? "on" : ""} />
                ))}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <details open>
        <summary>Gaps to work on</summary>
        <ul className="gaps">
          {plan.gaps.gaps.map((g) => (
            <li key={g.skill}>
              <div className="gap-head">
                <span>{g.skill}</span>
                <span className={`pill ${g.priority}`}>{g.priority}</span>
              </div>
              <p className="muted">{g.advice}</p>
            </li>
          ))}
        </ul>
        {plan.gaps.strengths.length > 0 && (
          <p className="strengths">
            <strong>Strengths:</strong> {plan.gaps.strengths.join(" · ")}
          </p>
        )}
      </details>

      <details open>
        <summary>Question bank</summary>
        <ol className="questions">
          {plan.questions.map((q, i) => {
            const s = scoreFor(q.id);
            const current = i === state.currentQuestion;
            return (
              <li key={q.id} className={current ? "current" : s ? "answered" : ""}>
                <div className="q-meta">
                  <span className="q-type">{q.type}</span>
                  <span className="q-comp">{q.competency}</span>
                  {s ? <span className={`score s${s.score}`}>{s.score}/5</span> : current && <span className="now">Now</span>}
                </div>
                <p>{q.prompt}</p>
              </li>
            );
          })}
        </ol>
      </details>

      <button className="btn ghost full" onClick={onNew}>
        Build a plan for another role
      </button>
    </div>
  );
}
