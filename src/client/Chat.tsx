import { useEffect, useRef, useState, type Dispatch, type FormEvent, type KeyboardEvent, type SetStateAction } from "react";
import { LIMITS, type AgentState, type ChatMessage } from "../shared/types";
import { sendChat } from "./api";
import { Markdown } from "./Markdown";

interface Props {
  session: string;
  state: AgentState;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  historyStatus: "loading" | "ready" | "error";
  onRetryHistory: () => void;
  onGoToPlan: () => void;
}

export function Chat({ session, state, messages, setMessages, historyStatus, onRetryHistory, onGoToPlan }: Props) {
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ text: string; error: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = streaming !== null;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming, failed]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    if (trimmed.length > LIMITS.messageMax) {
      setFailed({ text: trimmed, error: `Message is too long (max ${LIMITS.messageMax} characters).` });
      return;
    }
    setFailed(null);
    setInput("");
    const optimistic: ChatMessage = { id: "pending-" + Date.now(), role: "user", content: trimmed, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    setStreaming("");
    try {
      const reply = await sendChat(session, trimmed, (d) => setStreaming((s) => (s ?? "") + d));
      setMessages((m) => [
        ...m,
        { id: "reply-" + Date.now(), role: "assistant", content: reply, createdAt: new Date().toISOString() },
      ]);
    } catch (err) {
      // Server rolls back the user message on failure, so drop the optimistic copy and offer a retry.
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      const network = err instanceof TypeError || (err instanceof Error && /network|fetch|stream/i.test(err.message));
      setFailed({
        text: trimmed,
        error: network
          ? "The reply was interrupted. Check your connection and try again."
          : err instanceof Error
            ? err.message
            : "The model didn't respond.",
      });
      setInput(trimmed);
    } finally {
      setStreaming(null);
      inputRef.current?.focus();
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  }

  const plan = state.plan;
  const interviewDone = plan && state.currentQuestion >= plan.questions.length;
  const quick = plan
    ? interviewDone
      ? ["What should I practise first?", "Give me a model answer for my weakest question"]
      : ["Give me a hint", "Can you clarify the question?", "Skip this question"]
    : ["How should I structure a behavioral answer?", "What do interviewers look for in system design?"];

  return (
    <section className="panel chat" aria-label="Mock interview">
      <div className="chat-scroll" ref={scroller}>
        {historyStatus === "loading" && <div className="skeleton" aria-label="Loading conversation" />}
        {historyStatus === "error" && (
          <div className="alert error">
            Couldn't load your conversation.{" "}
            <button className="link" onClick={onRetryHistory}>
              Retry
            </button>
          </div>
        )}
        {historyStatus === "ready" && messages.length === 0 && !busy && <EmptyState hasPlan={!!plan} onGoToPlan={onGoToPlan} />}

        <ol className="messages">
          {messages.map((m) => (
            <Message key={m.id} message={m} />
          ))}
          {busy && (
            <li className="msg assistant">
              <div className="bubble">
                {streaming ? <Markdown text={streaming} /> : <span className="typing" aria-label="Thinking"><i /><i /><i /></span>}
              </div>
            </li>
          )}
        </ol>

        {failed && (
          <div className="alert error" role="alert">
            {failed.error}{" "}
            <button className="link" onClick={() => void send(failed.text)}>
              Retry
            </button>
          </div>
        )}
      </div>

      <form className="composer" onSubmit={onSubmit}>
        <div className="quick" aria-label="Suggestions">
          {quick.map((q) => (
            <button key={q} type="button" className="chip" disabled={busy} onClick={() => void send(q)}>
              {q}
            </button>
          ))}
        </div>
        <div className="composer-row">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={LIMITS.messageMax}
            placeholder={plan ? "Type your answer…  (Enter to send, Shift+Enter for a new line)" : "Ask about interviewing, or build a prep plan first"}
            aria-label="Your message"
          />
          <button type="submit" className="btn primary send" disabled={busy || !input.trim()}>
            {busy ? "…" : "Send"}
          </button>
        </div>
        {input.length > LIMITS.messageMax * 0.8 && (
          <span className="field-hint">
            {input.length} / {LIMITS.messageMax}
          </span>
        )}
      </form>
    </section>
  );
}

function Message({ message }: { message: ChatMessage }) {
  const ev = message.evaluation;
  return (
    <li className={`msg ${message.role}`}>
      <div className="bubble">
        <Markdown text={message.content} />
      </div>
      {ev && (
        <details className={`eval s${ev.score}`}>
          <summary>
            <span className="score-badge">{ev.score}/5</span> {ev.verdict}
          </summary>
          {ev.strengths.length > 0 && (
            <>
              <h4>Worked well</h4>
              <ul>{ev.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
            </>
          )}
          {ev.improve.length > 0 && (
            <>
              <h4>To improve</h4>
              <ul>{ev.improve.map((s) => <li key={s}>{s}</li>)}</ul>
            </>
          )}
        </details>
      )}
    </li>
  );
}

function EmptyState({ hasPlan, onGoToPlan }: { hasPlan: boolean; onGoToPlan: () => void }) {
  return (
    <div className="empty">
      <h1>Practise the interview before the interview.</h1>
      <ol className="how">
        <li>
          <strong>Paste a job description.</strong> A multi-step agent extracts the role, maps your gaps and writes a
          question bank.
        </li>
        <li>
          <strong>Answer out loud, then type it.</strong> Each answer is graded against what a hiring manager looks for.
        </li>
        <li>
          <strong>Come back anytime.</strong> Your plan, scores and conversation are saved to your own Durable Object.
        </li>
      </ol>
      {!hasPlan && (
        <button className="btn primary mobile-only" onClick={onGoToPlan}>
          Build a prep plan
        </button>
      )}
    </div>
  );
}
