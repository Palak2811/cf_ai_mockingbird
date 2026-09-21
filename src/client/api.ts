// Client-side helpers for talking to the PrepAgent over HTTP.
import type { ChatMessage } from "../shared/types";

const SESSION_KEY = "mockingbird.session";

/** Stable anonymous session id; it names the user's Durable Object. */
export function getSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return "anonymous-" + crypto.randomUUID();
  }
}

const base = (session: string) => `/agents/prep-agent/${encodeURIComponent(session)}`;

async function errorFrom(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error ?? `Request failed (${res.status})`);
}

export async function fetchHistory(session: string): Promise<ChatMessage[]> {
  const res = await fetch(`${base(session)}/history`, { cache: "no-store" });
  if (!res.ok) throw await errorFrom(res);
  return ((await res.json()) as { messages: ChatMessage[] }).messages;
}

export async function startAnalysis(session: string, jobDescription: string, background: string) {
  const res = await fetch(`${base(session)}/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobDescription, background }),
  });
  if (!res.ok) throw await errorFrom(res);
}

export async function resetSession(session: string) {
  const res = await fetch(`${base(session)}/reset`, { method: "POST" });
  if (!res.ok) throw await errorFrom(res);
}

/** POST a chat message and stream the plain-text reply through onDelta. */
export async function sendChat(session: string, message: string, onDelta: (text: string) => void, signal?: AbortSignal) {
  const res = await fetch(`${base(session)}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
    signal,
  });
  if (!res.ok || !res.body) throw await errorFrom(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    full += text;
    onDelta(text);
  }
  if (!full.trim()) throw new Error("The model returned an empty reply.");
  return full;
}
