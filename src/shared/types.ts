// Types shared by the Worker (agent + workflow) and the React client.

export type StepStatus = "pending" | "running" | "done" | "error";
export type JobStatus = "idle" | "running" | "complete" | "error";

export interface Competency {
  name: string;
  weight: number; // 1-5, how central it is to the role
  why: string;
}

export interface RoleProfile {
  role: string;
  seniority: string;
  company: string;
  summary: string;
  competencies: Competency[];
}

export interface GapAnalysis {
  strengths: string[];
  gaps: { skill: string; priority: "high" | "medium" | "low"; advice: string }[];
}

export interface InterviewQuestion {
  id: string;
  competency: string;
  type: "technical" | "behavioral" | "design";
  prompt: string;
  lookFor: string[];
}

export interface PrepPlan {
  profile: RoleProfile;
  gaps: GapAnalysis;
  questions: InterviewQuestion[];
  createdAt: string;
}

export interface JobStep {
  id: "profile" | "gaps" | "questions" | "save";
  label: string;
  status: StepStatus;
}

export interface Evaluation {
  score: number; // 1-5
  verdict: string;
  strengths: string[];
  improve: string[];
}

export interface AgentState {
  plan: PrepPlan | null;
  job: { status: JobStatus; steps: JobStep[]; error?: string; instanceId?: string };
  // Index into plan.questions of the question currently being asked.
  currentQuestion: number;
  scores: { questionId: string; score: number; verdict: string }[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  evaluation?: Evaluation | null;
}

export const INITIAL_STEPS: JobStep[] = [
  { id: "profile", label: "Reading the job description", status: "pending" },
  { id: "gaps", label: "Mapping strengths and gaps", status: "pending" },
  { id: "questions", label: "Writing your question bank", status: "pending" },
  { id: "save", label: "Saving your prep plan", status: "pending" },
];

export const INITIAL_STATE: AgentState = {
  plan: null,
  job: { status: "idle", steps: INITIAL_STEPS },
  currentQuestion: 0,
  scores: [],
};

export const LIMITS = {
  messageMax: 4000,
  jobDescriptionMin: 80,
  jobDescriptionMax: 12000,
  backgroundMax: 4000,
};
