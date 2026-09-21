// PrepWorkflow: a durable, multi-step pipeline that turns a job description into a prep plan.
// Each LLM call is its own `step.do`, so results are checkpointed. If step 3 fails, steps 1-2
// are not re-run, and each step retries with exponential backoff before the run fails.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { getAgentByName } from "agents";
import type { JobStep, PrepPlan } from "../shared/types";
import { extractJson, runJson, runText, type LlmMessage } from "./llm";
import { gapsPrompt, profilePrompt, questionsPrompt, schemas } from "./prompts";
import { asGaps, asProfile, asQuestions } from "./validate";

export interface PrepParams {
  agentName: string;
  jobDescription: string;
  background: string;
}

const STEP_CONFIG = {
  retries: { limit: 3, delay: "3 seconds", backoff: "exponential" },
  timeout: "2 minutes",
} as const;

/**
 * Run a JSON LLM call and validate it. Schema-constrained decoding sometimes collapses to empty
 * arrays, so if validation fails we make one free-form attempt with the schema in the prompt.
 * If that also fails, the error propagates and the workflow step retries.
 */
async function generate<T>(ai: Ai, messages: LlmMessage[], schema: Record<string, unknown>, check: (raw: unknown) => T, maxTokens?: number) {
  const raw = await runJson<unknown>(ai, messages, schema, maxTokens);
  try {
    return check(raw);
  } catch {
    console.warn("unusable constrained output, trying free-form:", JSON.stringify(raw).slice(0, 300));
  }
  const [system, ...rest] = messages;
  const freeform: LlmMessage[] = [
    { role: "system", content: `${system.content}\nRespond with a single JSON object matching this JSON Schema, with every array filled:\n${JSON.stringify(schema)}` },
    ...rest,
  ];
  const text = await runText(ai, freeform, maxTokens);
  try {
    return check(extractJson(text));
  } catch (err) {
    console.warn("unusable free-form output:", text.slice(0, 500));
    throw err;
  }
}

export class PrepWorkflow extends WorkflowEntrypoint<Env, PrepParams> {
  async run(event: WorkflowEvent<PrepParams>, step: WorkflowStep) {
    const { agentName, jobDescription, background } = event.payload;
    const instanceId = event.instanceId;
    const agent = await getAgentByName(this.env.PrepAgent, agentName);
    const report = (id: JobStep["id"], status: JobStep["status"]) =>
      step.do(`report ${id} ${status}`, () => agent.jobStepUpdate(instanceId, id, status));

    let current: JobStep["id"] = "profile";
    try {
      await report("profile", "running");
      const profile = await step.do("extract role profile", STEP_CONFIG, () =>
        generate(this.env.AI, profilePrompt(jobDescription), schemas.profile, asProfile),
      );
      await report("profile", "done");

      current = "gaps";
      await report("gaps", "running");
      const gaps = await step.do("analyse gaps", STEP_CONFIG, () =>
        generate(this.env.AI, gapsPrompt(profile, background), schemas.gaps, asGaps),
      );
      await report("gaps", "done");

      current = "questions";
      await report("questions", "running");
      const questions = await step.do("generate questions", STEP_CONFIG, () =>
        generate(this.env.AI, questionsPrompt(profile, gaps), schemas.questions, asQuestions, 2500),
      );
      await report("questions", "done");

      current = "save";
      await report("save", "running");
      const plan: PrepPlan = { profile, gaps, questions, createdAt: new Date().toISOString() };
      await step.do("save plan to agent", STEP_CONFIG, () => agent.jobCompleted(instanceId, plan));
      return { questions: questions.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await step.do("report failure", () => agent.jobFailed(instanceId, current, message));
      throw err;
    }
  }
}
