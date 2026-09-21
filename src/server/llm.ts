// Thin wrapper around Workers AI: model choice, JSON-mode calls and streaming.

export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

export class LlmError extends Error {}

/** Pull the first balanced JSON object out of model text (handles ```json fences and chatter). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) throw new LlmError("Model returned no JSON object");
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new LlmError("Model returned truncated JSON");
}

/** Non-streaming call that must return a JSON object. Throws so callers (e.g. workflow steps) can retry. */
export async function runJson<T>(
  ai: Ai,
  messages: LlmMessage[],
  schema: Record<string, unknown>,
  maxTokens = 1500,
): Promise<T> {
  const result = (await ai.run(MODEL, {
    messages,
    max_tokens: maxTokens,
    temperature: 0.3,
    response_format: { type: "json_schema", json_schema: schema },
  } as never)) as { response?: unknown };
  const raw = result?.response;
  if (raw && typeof raw === "object") return raw as T;
  if (typeof raw === "string" && raw.trim()) return extractJson(raw) as T;
  throw new LlmError("Empty response from model");
}

/** Non-streaming, unconstrained text call. */
export async function runText(ai: Ai, messages: LlmMessage[], maxTokens = 1500): Promise<string> {
  const result = (await ai.run(MODEL, { messages, max_tokens: maxTokens, temperature: 0.3 } as never)) as { response?: unknown };
  const raw = result?.response;
  if (typeof raw === "string" && raw.trim()) return raw;
  if (raw && typeof raw === "object") return JSON.stringify(raw);
  throw new LlmError("Empty response from model");
}

/**
 * Streaming chat call. Workers AI returns an SSE byte stream ("data: {response}" lines);
 * we convert it to plain text deltas via the onDelta callback and resolve with the full text.
 */
export async function streamChat(
  ai: Ai,
  messages: LlmMessage[],
  onDelta: (text: string) => void | Promise<void>,
): Promise<string> {
  const stream = (await ai.run(MODEL, {
    messages,
    stream: true,
    max_tokens: 900,
    temperature: 0.6,
  } as never)) as unknown as ReadableStream<Uint8Array>;

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const delta = (JSON.parse(data) as { response?: string }).response;
        if (delta) {
          full += delta;
          await onDelta(delta);
        }
      } catch {
        // ignore keep-alive / partial frames
      }
    }
  }
  if (!full.trim()) throw new LlmError("Model returned an empty reply");
  return full;
}
