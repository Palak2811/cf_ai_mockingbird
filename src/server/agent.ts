// PrepAgent: one Durable Object per user session (Agents SDK).
// - Synced state (plan, workflow progress, scores) is pushed to connected clients over WebSocket.
// - Chat history lives in the agent's built-in SQLite, so it survives refreshes and restarts.
// - HTTP routes: GET /history, POST /chat (streamed), POST /analyze, POST /reset.
import { Agent } from "agents";
import {
  INITIAL_STATE,
  INITIAL_STEPS,
  LIMITS,
  type AgentState,
  type ChatMessage,
  type Evaluation,
  type JobStep,
  type PrepPlan,
} from "../shared/types";
import { runJson, streamChat, type LlmMessage } from "./llm";
import { evaluatePrompt, interviewerSystemPrompt, openingMessage, schemas } from "./prompts";
import { asEvaluation } from "./validate";

const CONTEXT_MESSAGES = 16; // recent turns sent to the model

type Row = { id: string; role: "user" | "assistant"; content: string; created_at: string; evaluation: string | null };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export class PrepAgent extends Agent<Env, AgentState> {
  initialState = INITIAL_STATE;
  private chatInFlight = false;

  async onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      evaluation TEXT
    )`;
  }

  async onRequest(request: Request): Promise<Response> {
    const route = new URL(request.url).pathname.split("/").pop();
    try {
      if (request.method === "GET" && route === "history") return json({ messages: this.history() });
      if (request.method === "POST" && route === "chat") return await this.handleChat(request);
      if (request.method === "POST" && route === "analyze") return await this.handleAnalyze(request);
      if (request.method === "POST" && route === "reset") return this.handleReset();
      return json({ error: "Not found" }, 404);
    } catch (err) {
      console.error("agent request failed", err);
      return json({ error: "Something went wrong on our side. Please try again." }, 500);
    }
  }

  // ---------- persistence ----------

  private history(): ChatMessage[] {
    return this.sql<Row>`SELECT * FROM messages ORDER BY created_at ASC, rowid ASC`.map((r) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      createdAt: r.created_at,
      evaluation: r.evaluation ? (JSON.parse(r.evaluation) as Evaluation) : null,
    }));
  }

  private saveMessage(role: "user" | "assistant", content: string): string {
    const id = crypto.randomUUID();
    this.sql`INSERT INTO messages (id, role, content, created_at) VALUES (${id}, ${role}, ${content}, ${new Date().toISOString()})`;
    return id;
  }

  // ---------- chat ----------

  private async handleChat(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as { message?: unknown } | null;
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message) return json({ error: "Message cannot be empty." }, 400);
    if (message.length > LIMITS.messageMax)
      return json({ error: `Message is too long (max ${LIMITS.messageMax} characters).` }, 400);
    if (this.chatInFlight) return json({ error: "Still answering your previous message." }, 409);

    // Snapshot context before saving the new message.
    const state = this.state;
    const recent = this.history().slice(-CONTEXT_MESSAGES);
    const userId = this.saveMessage("user", message);
    const messages: LlmMessage[] = [
      { role: "system", content: interviewerSystemPrompt(state) },
      ...recent.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

    // Grade the answer in parallel with the streamed reply (only during an active interview).
    const question = state.plan?.questions[state.currentQuestion];
    const evaluation = question
      ? runJson(this.env.AI, evaluatePrompt(question, message), schemas.evaluation, 400)
          .then(asEvaluation)
          .catch((err) => {
            console.warn("evaluation failed", err);
            return null;
          })
      : Promise.resolve(null);

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    this.chatInFlight = true;

    (async () => {
      try {
        const reply = await streamChat(this.env.AI, messages, (delta) => writer.write(encoder.encode(delta)));
        this.saveMessage("assistant", reply);
        const result = await evaluation;
        if (result && question && result.score > 0) {
          this.sql`UPDATE messages SET evaluation = ${JSON.stringify(result)} WHERE id = ${userId}`;
          this.setState({
            ...this.state,
            currentQuestion: this.state.currentQuestion + 1,
            scores: [...this.state.scores, { questionId: question.id, score: result.score, verdict: result.verdict }],
          });
        }
        await writer.close();
      } catch (err) {
        console.error("chat failed", err);
        // Roll back the user message so a retry does not duplicate it.
        this.sql`DELETE FROM messages WHERE id = ${userId}`;
        await writer.abort(err).catch(() => {});
      } finally {
        this.chatInFlight = false;
      }
    })();

    return new Response(readable, {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-user-message-id": userId },
    });
  }

  // ---------- prep-plan workflow ----------

  private async handleAnalyze(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as { jobDescription?: unknown; background?: unknown } | null;
    const jd = typeof body?.jobDescription === "string" ? body.jobDescription.trim() : "";
    const background = typeof body?.background === "string" ? body.background.trim() : "";
    if (jd.length < LIMITS.jobDescriptionMin)
      return json({ error: `Paste the full job description (at least ${LIMITS.jobDescriptionMin} characters).` }, 400);
    if (jd.length > LIMITS.jobDescriptionMax)
      return json({ error: `Job description is too long (max ${LIMITS.jobDescriptionMax} characters).` }, 400);
    if (background.length > LIMITS.backgroundMax)
      return json({ error: `Background is too long (max ${LIMITS.backgroundMax} characters).` }, 400);
    if (this.state.job.status === "running") return json({ error: "A prep plan is already being built." }, 409);

    const instance = await this.env.PREP_WORKFLOW.create({
      params: { agentName: this.name, jobDescription: jd, background },
    });
    this.setState({
      ...this.state,
      job: { status: "running", steps: INITIAL_STEPS.map((s) => ({ ...s })), instanceId: instance.id },
    });
    return json({ instanceId: instance.id }, 202);
  }

  /** RPC from PrepWorkflow. Ignores updates from superseded runs. */
  async jobStepUpdate(instanceId: string, id: JobStep["id"], status: JobStep["status"]) {
    if (this.state.job.instanceId !== instanceId) return;
    const steps = this.state.job.steps.map((s) => (s.id === id ? { ...s, status } : s));
    this.setState({ ...this.state, job: { ...this.state.job, steps } });
  }

  async jobCompleted(instanceId: string, plan: PrepPlan) {
    if (this.state.job.instanceId !== instanceId) return;
    const steps = this.state.job.steps.map((s) => ({ ...s, status: "done" as const }));
    // A new plan starts a fresh interview: clear old chat and scores, then open with question 1.
    this.sql`DELETE FROM messages`;
    this.saveMessage("assistant", openingMessage(plan));
    this.setState({ plan, currentQuestion: 0, scores: [], job: { status: "complete", steps, instanceId } });
  }

  async jobFailed(instanceId: string, id: JobStep["id"], error: string) {
    if (this.state.job.instanceId !== instanceId) return;
    console.error("workflow failed", error);
    const steps = this.state.job.steps.map((s) => (s.id === id ? { ...s, status: "error" as const } : s));
    this.setState({
      ...this.state,
      job: { status: "error", steps, instanceId, error: "The model returned unusable output after several retries. Please try again." },
    });
  }

  private handleReset(): Response {
    this.sql`DELETE FROM messages`;
    this.setState({ ...INITIAL_STATE, job: { status: "idle", steps: INITIAL_STEPS.map((s) => ({ ...s })) } });
    return json({ ok: true });
  }
}
