// Runtime validation of model output. LLMs can return well-formed JSON with the wrong shape,
// so we normalise here and throw (which triggers a workflow step retry) when output is unusable.
import type { Evaluation, GapAnalysis, InterviewQuestion, RoleProfile } from "../shared/types";
import { LlmError } from "./llm";

/* eslint-disable @typescript-eslint/no-explicit-any */
const str = (v: unknown, fallback = "") => (typeof v === "string" && v.trim() ? v.trim() : fallback);
const strArr = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);
const clamp = (n: unknown, lo: number, hi: number, d: number) => {
  const num = typeof n === "string" ? Number(n) : n;
  return typeof num === "number" && Number.isFinite(num) ? Math.min(hi, Math.max(lo, Math.round(num))) : d;
};

export function asProfile(raw: any): RoleProfile {
  const competencies = (Array.isArray(raw?.competencies) ? raw.competencies : [])
    .map((c: any) => ({ name: str(c?.name), weight: clamp(c?.weight, 1, 5, 3), why: str(c?.why) }))
    .filter((c: { name: string }) => c.name);
  if (!str(raw?.role) || competencies.length === 0) throw new LlmError("Profile missing role or competencies");
  return {
    role: str(raw.role),
    seniority: str(raw.seniority, "Unknown"),
    company: str(raw.company, "Unknown"),
    summary: str(raw.summary),
    competencies: competencies.slice(0, 8),
  };
}

export function asGaps(raw: any): GapAnalysis {
  const gaps = (Array.isArray(raw?.gaps) ? raw.gaps : [])
    .map((g: any) => ({
      skill: str(g?.skill),
      priority: (["high", "medium", "low"].includes(g?.priority) ? g.priority : "medium") as "high" | "medium" | "low",
      advice: str(g?.advice),
    }))
    .filter((g: { skill: string }) => g.skill);
  if (gaps.length === 0) throw new LlmError("Gap analysis returned no gaps");
  return { strengths: strArr(raw?.strengths).slice(0, 5), gaps: gaps.slice(0, 6) };
}

export function asQuestions(raw: any): InterviewQuestion[] {
  const qs = (Array.isArray(raw?.questions) ? raw.questions : [])
    .map((q: any) => ({
      competency: str(q?.competency, "General"),
      type: (["technical", "behavioral", "design"].includes(q?.type) ? q.type : "technical") as InterviewQuestion["type"],
      prompt: str(q?.prompt),
      lookFor: strArr(q?.lookFor).slice(0, 5),
    }))
    .filter((q: { prompt: string }) => q.prompt.length > 10)
    .map((q: Omit<InterviewQuestion, "id">, i: number) => ({ id: `q${i + 1}`, ...q }));
  if (qs.length < 3) throw new LlmError(`Only ${qs.length} usable questions generated`);
  return qs.slice(0, 8);
}

export function asEvaluation(raw: any): Evaluation {
  return {
    score: clamp(raw?.score, 0, 5, 0),
    verdict: truncate(str(raw?.verdict), 160),
    strengths: strArr(raw?.strengths).slice(0, 3),
    improve: strArr(raw?.improve).slice(0, 3),
  };
}

function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), max * 0.6)).trimEnd() + "…";
}
