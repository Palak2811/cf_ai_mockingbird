import { useCallback, useEffect, useRef, useState } from "react";
import { useAgent } from "agents/react";
import { INITIAL_STATE, type AgentState, type ChatMessage } from "../shared/types";
import { fetchHistory, getSessionId, resetSession } from "./api";
import { PlanPanel } from "./PlanPanel";
import { Chat } from "./Chat";

type Tab = "plan" | "interview";

export function App() {
  const [session] = useState(getSessionId);
  const [state, setState] = useState<AgentState>(INITIAL_STATE);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyStatus, setHistoryStatus] = useState<"loading" | "ready" | "error">("loading");
  const [tab, setTab] = useState<Tab>("plan");
  const [resetting, setResetting] = useState(false);

  // WebSocket connection to this session's Durable Object; state changes are pushed live.
  useAgent<AgentState>({
    agent: "prep-agent",
    name: session,
    onStateUpdate: (s) => setState(s),
    onOpen: () => setConnected(true),
    onClose: () => setConnected(false),
  });

  // Several loads can overlap (mount, plan ready, new score); only the newest may update the UI,
  // otherwise a slow, older response could overwrite fresher history.
  const latestLoad = useRef(0);
  const loadHistory = useCallback(async () => {
    const id = ++latestLoad.current;
    try {
      const history = await fetchHistory(session);
      if (id !== latestLoad.current) return;
      setMessages(history);
      setHistoryStatus("ready");
    } catch {
      if (id === latestLoad.current) setHistoryStatus("error");
    }
  }, [session]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // New plan => the agent seeded an opening question; new score => an answer got its evaluation.
  const planStamp = state.plan?.createdAt;
  const scoreCount = state.scores.length;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void loadHistory();
  }, [planStamp, scoreCount, loadHistory]);

  // When a plan finishes on mobile, jump to the interview.
  const prevJob = useRef(state.job.status);
  useEffect(() => {
    if (prevJob.current === "running" && state.job.status === "complete") setTab("interview");
    prevJob.current = state.job.status;
  }, [state.job.status]);

  async function handleReset() {
    if (!confirm("Start over? This clears your prep plan, scores and conversation.")) return;
    setResetting(true);
    try {
      await resetSession(session);
      setMessages([]);
      setTab("plan");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not reset. Please try again.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="app" data-tab={tab}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">M</span>
          <span className="brand-name">Mockingbird</span>
          <span className="brand-tag">AI interview prep</span>
        </div>
        <div className="topbar-actions">
          <span className={`conn ${connected ? "on" : ""}`} title={connected ? "Live connection to your agent" : "Reconnecting…"}>
            <span className="conn-dot" aria-hidden="true" />
            <span className="conn-label">{connected ? "Synced" : "Connecting"}</span>
          </span>
          <button className="btn ghost small" onClick={handleReset} disabled={resetting || state.job.status === "running"}>
            {resetting ? "Clearing…" : "Start over"}
          </button>
        </div>
      </header>

      <nav className="tabs" aria-label="Sections">
        <button aria-pressed={tab === "plan"} onClick={() => setTab("plan")}>Prep plan</button>
        <button aria-pressed={tab === "interview"} onClick={() => setTab("interview")}>
          Interview{state.plan ? ` · ${Math.min(state.currentQuestion, state.plan.questions.length)}/${state.plan.questions.length}` : ""}
        </button>
      </nav>

      <main className="layout">
        <PlanPanel session={session} state={state} />
        <Chat
          session={session}
          state={state}
          messages={messages}
          setMessages={setMessages}
          historyStatus={historyStatus}
          onRetryHistory={loadHistory}
          onGoToPlan={() => setTab("plan")}
        />
      </main>
    </div>
  );
}
