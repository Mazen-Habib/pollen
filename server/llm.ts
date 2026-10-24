import { getSettings, isGroq, type Settings } from "./settings.ts";
import { AppError, ALT } from "./errors.ts";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export type CompletionOpts = {
  messages: ChatMsg[];
  model?: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  webSearch?: boolean;
  reasoning?: "low" | "medium" | "high";
  signal?: AbortSignal;
};

/** Rough token estimate (~4 chars per token for English). Good enough for budgeting. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function requireKey(s: Settings) {
  if (!s.llmApiKey) {
    throw new AppError("No AI API key yet. Add your free Groq key in Settings.", {
      status: 400,
      alternatives: [ALT.groqKey],
    });
  }
}

function buildBody(s: Settings, opts: CompletionOpts, model: string, stream: boolean) {
  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.7,
    stream,
  };
  const usesCompletionTokens = isGroq(s) || s.llmBaseUrl.includes("openai.com");
  body[usesCompletionTokens ? "max_completion_tokens" : "max_tokens"] = opts.maxTokens ?? 2048;
  if (opts.json) body.response_format = { type: "json_object" };
  if (isGroq(s) && model.includes("gpt-oss")) {
    body.reasoning_effort = opts.reasoning ?? (opts.webSearch ? "low" : "medium");
  }
  if (opts.webSearch) {
    body.tools = [{ type: "browser_search" }];
    body.tool_choice = "auto";
  }
  return body;
}

async function readError(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(text);
    return String(parsed?.error?.message ?? parsed?.message ?? text);
  } catch {
    return text || res.statusText;
  }
}

/**
 * POST a chat completion, handling the Groq free tier's limits:
 * short 429 waits are retried, long waits / oversized requests fall back to the fallback model.
 */
async function sendCompletion(opts: CompletionOpts, stream: boolean): Promise<{ res: Response; model: string }> {
  const s = getSettings();
  requireKey(s);
  if (opts.webSearch && !isGroq(s)) {
    throw new AppError("Live web search works with Groq only (its built-in browser_search tool).", {
      hint: "Switch the AI provider back to Groq in Settings, or turn web search off and add the page as a Link node instead.",
      alternatives: [ALT.groqKey],
    });
  }

  const primary = opts.model ?? (opts.webSearch ? s.searchModel : s.chatModel);
  const models = [primary];
  if (!opts.webSearch && s.fallbackModel && s.fallbackModel !== primary) models.push(s.fallbackModel);

  let lastError = "";
  let lastStatus = 0;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`${s.llmBaseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${s.llmApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildBody(s, opts, model, stream)),
        signal: opts.signal,
      });
      if (res.ok) return { res, model };

      lastStatus = res.status;
      lastError = await readError(res);
      if (res.status === 401 || res.status === 403) {
        throw new AppError(`The AI provider rejected the API key (${res.status}).`, {
          status: 401,
          hint: lastError,
          alternatives: [ALT.groqKey],
        });
      }
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after") ?? "0");
        if (attempt === 0 && retryAfter > 0 && retryAfter <= 12) {
          await sleep(retryAfter * 1000 + 250);
          continue;
        }
        break; // try the next model
      }
      if (res.status === 413) break; // request bigger than this model's per-minute token limit
      if (res.status >= 500 && attempt === 0) {
        await sleep(1500);
        continue;
      }
      throw new AppError(`AI request failed (${res.status}).`, { status: 502, hint: lastError });
    }
  }

  if (lastStatus === 429 || lastStatus === 413) {
    throw new AppError("Hit the AI provider's free-tier rate limit.", {
      status: 429,
      hint:
        `${lastError} — Wait a minute and try again, connect fewer/shorter sources, or lower "Context budget" in Settings. ` +
        "Groq's paid Developer tier (pay-as-you-go) raises the limits roughly 10×.",
    });
  }
  throw new AppError("AI request failed.", { status: 502, hint: lastError });
}

/** Groq browser_search answers contain citation markers like 【2†L6-L10】 — strip them. */
const stripCitations = (text: string) => text.replace(/【[^】]*】/g, "");

export async function complete(opts: CompletionOpts): Promise<{ text: string; model: string }> {
  const { res, model } = await sendCompletion(opts, false);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return { text: stripCitations(data.choices?.[0]?.message?.content ?? "").trim(), model };
}

/** Ask for JSON and parse it, retrying once if the model returns something unparseable. */
export async function completeJson<T>(opts: CompletionOpts): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text } = await complete({ ...opts, json: true, temperature: attempt ? 0.3 : opts.temperature });
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      return JSON.parse(text.slice(start, end + 1)) as T;
    } catch (err) {
      if (err instanceof AppError && err.status !== 502) throw err;
      if (attempt === 1) throw new AppError("The AI returned an unreadable answer. Try again.", { status: 502 });
    }
  }
  throw new Error("unreachable");
}

export type StreamEvent = { type: "delta"; text: string } | { type: "model"; model: string };

export async function* stream(opts: CompletionOpts): AsyncGenerator<StreamEvent> {
  const { res, model } = await sendCompletion(opts, true);
  yield { type: "model", model };
  if (!res.body) throw new AppError("Empty response from the AI provider.", { status: 502 });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let pending = ""; // holds a partial 【citation】 marker split across chunks

  const emit = function* (text: string): Generator<StreamEvent> {
    pending += text;
    const open = pending.lastIndexOf("【");
    let ready = pending;
    if (open !== -1 && pending.indexOf("】", open) === -1) {
      ready = pending.slice(0, open);
      pending = pending.slice(open);
    } else {
      pending = "";
    }
    const cleaned = stripCitations(ready);
    if (cleaned) yield { type: "delta", text: cleaned };
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      let chunk: { choices?: { delta?: { content?: string } }[]; error?: { message?: string } };
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }
      if (chunk.error) throw new AppError(chunk.error.message ?? "AI stream error", { status: 502 });
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) yield* emit(delta);
    }
  }
  if (pending) yield { type: "delta", text: stripCitations(pending) };
}

export const WHISPER_MAX_BYTES = 25 * 1024 * 1024;

/** Transcribe audio/video with Whisper (free on Groq). */
export async function transcribe(file: Blob, filename: string): Promise<string> {
  const s = getSettings();
  requireKey(s);
  if (file.size > WHISPER_MAX_BYTES) {
    throw new AppError("That file is over 25 MB, the free transcription limit.", {
      hint: "Trim the video or export just the audio (e.g. .m4a/.mp3) and upload that instead.",
    });
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const form = new FormData();
    form.append("file", file, filename);
    form.append("model", s.whisperModel);
    form.append("response_format", "json");
    const res = await fetch(`${s.llmBaseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${s.llmApiKey}` },
      body: form,
    });
    if (res.ok) {
      const data = (await res.json()) as { text?: string };
      return (data.text ?? "").trim();
    }
    const message = await readError(res);
    const retryAfter = Number(res.headers.get("retry-after") ?? "0");
    if (res.status === 429 && attempt === 0 && retryAfter > 0 && retryAfter <= 20) {
      await sleep(retryAfter * 1000 + 250);
      continue;
    }
    throw new AppError(`Transcription failed (${res.status}).`, { status: 502, hint: message });
  }
  throw new Error("unreachable");
}

/** Quick connectivity check used by Settings → Test. */
export async function testLlm() {
  const s = getSettings();
  requireKey(s);
  const res = await fetch(`${s.llmBaseUrl.replace(/\/$/, "")}/models`, {
    headers: { Authorization: `Bearer ${s.llmApiKey}` },
  });
  if (!res.ok) throw new AppError(`Provider said ${res.status}`, { hint: await readError(res) });
  const data = (await res.json()) as { data?: { id: string }[] };
  return (data.data ?? []).map((m) => m.id).sort();
}
