import { useEffect, useRef, useState } from "react";
import { Globe, Paperclip, Send, Square, Trash2, X } from "lucide-react";
import { api, ApiError, streamChat, type ChatMessage, type ContextSource } from "../api.ts";
import { CopyButton, ErrorBox, IconButton, Markdown, Spinner } from "./ui.tsx";

const SUGGESTIONS = [
  "What's working in my niche right now? Be specific.",
  "Give me 10 scroll-stopping hooks based on the top outliers.",
  "Turn the best outlier into a Reel script for my brand.",
  "What topics are these creators NOT covering that I could own?",
];

export function ChatPanel({
  chatId,
  scope,
  title,
  days,
  contextKey,
  onClose,
  onReplied,
}: {
  chatId: string;
  scope: "board" | "radar";
  title: string;
  days?: number;
  /** Bump to re-read which sources are connected. */
  contextKey?: number;
  onClose?: () => void;
  onReplied?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sources, setSources] = useState<ContextSource[]>([]);
  const [input, setInput] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadSources = () =>
    api<ContextSource[]>(`/chat/${chatId}/context?scope=${scope}${days ? `&days=${days}` : ""}`)
      .then(setSources)
      .catch(() => {});

  useEffect(() => {
    api<ChatMessage[]>(`/chat/${chatId}`).then(setMessages).catch(() => setMessages([]));
    setError(null);
  }, [chatId]);

  useEffect(() => {
    loadSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, contextKey, days]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, info]);

  const send = async (text = input) => {
    const message = text.trim();
    if (!message || streaming) return;
    setInput("");
    setError(null);
    setStreaming(true);
    setInfo("");
    setMessages((m) => [...m, { role: "user", content: message }, { role: "assistant", content: "" }]);
    const controller = new AbortController();
    abortRef.current = controller;
    let failed = false;
    try {
      await streamChat(
        chatId,
        { message, webSearch, scope, days },
        {
          context: setSources,
          info: setInfo,
          delta: (t) => {
            setInfo("");
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = { role: "assistant", content: copy[copy.length - 1].content + t };
              return copy;
            });
          },
          error: (e) => {
            failed = true;
            setError(e);
          },
        },
        controller.signal,
      );
    } catch (e) {
      if (!controller.signal.aborted) {
        failed = true;
        setError(e instanceof ApiError ? e : new ApiError(String(e), 0));
      }
    }
    if (failed) {
      // Nothing was saved server-side; put the message back so it can be retried.
      setMessages((m) => m.slice(0, -2));
      setInput(message);
    }
    setStreaming(false);
    setInfo("");
    onReplied?.();
  };

  const clear = async () => {
    await api(`/chat/${chatId}`, { method: "DELETE" });
    setMessages([]);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{title}</div>
          <div className="flex flex-wrap items-center gap-1 pt-1 text-xs text-fg-2">
            <Paperclip aria-label="Reading" className="h-3 w-3" />
            {sources.length ? (
              sources.map((s) => (
                <span key={s.label} className="max-w-[180px] truncate rounded bg-surface-2 px-1.5 py-0.5" title={s.label}>
                  {s.label}
                  {s.truncated ? " ✂" : ""}
                </span>
              ))
            ) : (
              <span>No sources connected. Drag a source onto this chat.</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {messages.length > 0 && (
            <IconButton label="Clear chat" tone="danger" onClick={clear}>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          )}
          {onClose && (
            <IconButton label="Close chat" onClick={onClose}>
              <X className="h-4 w-4" />
            </IconButton>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {!messages.length && (
          <div className="space-y-2">
            <p className="text-sm text-fg-2">Ask anything about the connected sources. Try:</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                className="block w-full rounded-lg border border-line px-3 py-2 text-left text-sm text-fg-2 transition-colors hover:border-line-strong hover:text-fg"
                onClick={() => send(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-8 rounded-xl bg-surface-2 px-3 py-2 text-sm whitespace-pre-wrap text-fg">
              {m.content}
            </div>
          ) : (
            <div key={i} className="group">
              {m.content ? <Markdown>{m.content}</Markdown> : streaming && i === messages.length - 1 && <Spinner />}
              {m.content && !(streaming && i === messages.length - 1) && (
                <div className="mt-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <CopyButton text={m.content} />
                </div>
              )}
            </div>
          ),
        )}
        {info && (
          <div className="flex items-center gap-2 text-sm text-fg-2">
            <Spinner /> {info}
          </div>
        )}
        {error && <ErrorBox error={error} onDismiss={() => setError(null)} />}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-line p-3">
        <textarea
          className="input h-20 resize-none"
          aria-label="Message"
          placeholder="Ask about these sources… (Enter to send, Shift+Enter for a new line)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="mt-2 flex items-center justify-between">
          <button
            aria-pressed={webSearch}
            className={`btn border ${webSearch ? "border-info/40 bg-info/10 text-info" : "border-transparent bg-surface-2 text-fg-2 hover:text-fg"}`}
            onClick={() => setWebSearch(!webSearch)}
            title="Let the AI search the web live (Groq browser search)"
          >
            <Globe aria-hidden className="h-4 w-4" /> Web search: {webSearch ? "On" : "Off"}
          </button>
          {streaming ? (
            <button className="btn-ghost" onClick={() => abortRef.current?.abort()}>
              <Square className="h-4 w-4" /> Stop
            </button>
          ) : (
            <button className="btn-primary" disabled={!input.trim()} onClick={() => send()}>
              <Send className="h-4 w-4" /> Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
