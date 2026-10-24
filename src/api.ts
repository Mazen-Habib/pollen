export type Alternative = {
  id: string;
  title: string;
  detail: string;
  cost?: string;
  steps?: string[];
  link?: string;
  action?: "settings:ai" | "settings:meta" | "settings:apify" | "manual-reel" | "upload" | "web-search";
};

export class ApiError extends Error {
  status: number;
  hint?: string;
  alternatives?: Alternative[];
  constructor(message: string, status: number, hint?: string, alternatives?: Alternative[]) {
    super(message);
    this.status = status;
    this.hint = hint;
    this.alternatives = alternatives;
  }
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body || opts.form ? "POST" : "GET"),
    headers: opts.form ? undefined : { "Content-Type": "application/json" },
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data.hint, data.alternatives);
  return data as T;
}

export type Reel = {
  id: string;
  url: string | null;
  owner: string | null;
  caption: string | null;
  thumbnail: string | null;
  video_url: string | null;
  audio_url: string | null;
  posted_at: number | null;
  duration: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  music: string | null;
  source: "meta" | "apify" | "manual";
  via_hashtag: string | null;
  first_seen_at: number;
  updated_at: number;
  transcript: string | null;
  analysis: string | null;
  analyzed_at: number | null;
  metric: "views" | "likes" | null;
  baseline: number | null;
  score: number | null;
  ageHours: number | null;
  vph: number | null;
  growthPerHour: number | null;
  viewsPerFollower: number | null;
  followers: number | null;
  job?: Job | null;
};

export type Job = {
  id: string;
  kind: "analyze" | "transcribe";
  reelId: string;
  label: string;
  status: "running" | "done" | "error";
  startedAt: number;
  finishedAt?: number;
  error?: { error: string; hint?: string; alternatives?: Alternative[] };
};

/** App-wide signals for background jobs: "started" (poll now) and "finished" (detail: Job). */
export const jobEvents = new EventTarget();
export const notifyJobStarted = () => jobEvents.dispatchEvent(new Event("started"));
export const jobErrorToApiError = (job: Job) =>
  new ApiError(job.error?.error ?? "Job failed", 0, job.error?.hint, job.error?.alternatives);

export type Creator = {
  username: string;
  full_name: string | null;
  followers: number | null;
  profile_pic: string | null;
  last_fetched_at: number | null;
  last_source: string | null;
  last_error: string | null;
  reel_count: number;
};

export type Hashtag = {
  tag: string;
  last_fetched_at: number | null;
  last_source: string | null;
  last_error: string | null;
  reel_count: number;
};

export type Board = { id: string; name: string; created_at: number; updated_at: number; node_count?: number };

export type NodeType = "note" | "chat" | "reel" | "creator" | "radar" | "url" | "file";

export type BoardNode = {
  id: string;
  board_id: string;
  type: NodeType;
  x: number;
  y: number;
  w: number | null;
  h: number | null;
  data: Record<string, any>;
  live: any;
};

export type BoardEdge = { id: string; source: string; target: string };

export type Idea = {
  id: string;
  report_id: string | null;
  created_at: number;
  title: string;
  hook: string;
  format: string;
  angle: string;
  why: string;
  based_on: string;
  status: IdeaStatus;
  script: string | null;
};

export type IdeaStatus = "new" | "saved" | "scripting" | "filmed" | "posted" | "dismissed";

export type Report = { id: string; created_at: number; title: string; headline?: string; body?: string; ideas?: Idea[] };

export type SourcesStatus = {
  llm: boolean;
  provider: string;
  meta: boolean;
  metaUsername: string;
  metaExpiresAt: number;
  apify: boolean;
  lastRefreshAt: number;
  alternatives: Alternative[];
};

export type RadarStatus = {
  running: boolean;
  startedAt: number;
  log: string[];
  error: string | null;
  lastRefreshAt: number;
  autoRefreshHours: number;
  last: null | {
    at: number;
    reelsSaved: number;
    reportId?: string;
    reportError?: string;
    creators: { name: string; ok: boolean; source?: string; count: number; error?: string }[];
    hashtags: { name: string; ok: boolean; source?: string; count: number; error?: string }[];
    alternatives: Alternative[];
  };
};

export type ChatMessage = { id?: number; role: "user" | "assistant"; content: string; meta?: string | null };
export type ContextSource = { label: string; truncated: boolean; tokens: number };

/** POST a chat message and read the server-sent event stream. */
export async function streamChat(
  chatId: string,
  body: { message: string; webSearch: boolean; scope: "board" | "radar"; days?: number },
  on: {
    context?: (sources: ContextSource[]) => void;
    info?: (text: string) => void;
    delta: (text: string) => void;
    done?: (data: { model: string }) => void;
    error: (err: ApiError) => void;
  },
  signal?: AbortSignal,
) {
  const res = await fetch(`/api/chat/${chatId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.body) return on.error(new ApiError("No response from server", 500));
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const raw of events) {
      const event = raw.match(/^event: (.*)$/m)?.[1];
      const dataLine = raw.match(/^data: (.*)$/m)?.[1];
      if (!event || dataLine === undefined) continue;
      const data = JSON.parse(dataLine);
      if (event === "delta") on.delta(data);
      else if (event === "context") on.context?.(data);
      else if (event === "info") on.info?.(data);
      else if (event === "done") on.done?.(data);
      else if (event === "error") on.error(new ApiError(data.error, 400, data.hint, data.alternatives));
    }
  }
}

/* ---------------------------------------------------------- formatting */

export const fmtNum = (n: number | null | undefined) =>
  n == null ? "–" : n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(Math.round(n));

export const timeAgo = (ms: number | null | undefined) => {
  if (!ms) return "never";
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString();
};

export const scoreTone = (score: number | null | undefined) =>
  score == null
    ? "bg-zinc-700 text-zinc-200"
    : score >= 5
      ? "bg-rose-500 text-white"
      : score >= 3
        ? "bg-orange-500 text-white"
        : score >= 1.5
          ? "bg-amber-400 text-zinc-950"
          : "bg-zinc-700 text-zinc-200";

export const thumbUrl = (reel: Pick<Reel, "id">) => `/api/reels/${encodeURIComponent(reel.id)}/thumb`;

export const navigate = (hash: string) => {
  window.location.hash = hash;
};
