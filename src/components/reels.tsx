import { useEffect, useRef, useState } from "react";
import { ExternalLink, Film, LayoutGrid, MessageCircle, Heart, Eye, Sparkles, Upload, Mic, Pencil } from "lucide-react";
import {
  api,
  fmtNum,
  jobErrorToApiError,
  notifyJobStarted,
  scoreTone,
  thumbUrl,
  timeAgo,
  type Board,
  type Reel,
} from "../api.ts";
import { ErrorBox, Markdown, Modal, Spinner, CopyButton, useAsync } from "./ui.tsx";

export function ScoreBadge({ reel, className = "" }: { reel: Reel; className?: string }) {
  if (reel.score == null) {
    return reel.viewsPerFollower != null ? (
      <span className={`rounded-md bg-zinc-700 px-1.5 py-0.5 text-xs font-semibold ${className}`} title="Views per follower">
        {reel.viewsPerFollower.toFixed(1)}×F
      </span>
    ) : null;
  }
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-xs font-bold ${scoreTone(reel.score)} ${className}`}
      title={`${reel.score.toFixed(2)}× @${reel.owner}'s median of ${fmtNum(reel.baseline)} ${reel.metric}`}
    >
      {reel.score >= 10 ? Math.round(reel.score) : reel.score.toFixed(1)}×
    </span>
  );
}

export function Thumb({ reel, className = "" }: { reel: Reel; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || (!reel.thumbnail && reel.source === "manual")) {
    return (
      <div className={`flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900 p-3 ${className}`}>
        <p className="line-clamp-6 text-center text-xs text-zinc-400">{reel.caption || <Film className="h-6 w-6" />}</p>
      </div>
    );
  }
  return (
    <img
      src={thumbUrl(reel)}
      alt=""
      loading="lazy"
      className={`object-cover ${className}`}
      onError={() => setFailed(true)}
    />
  );
}

export function ReelCard({ reel, onOpen }: { reel: Reel; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="card group overflow-hidden text-left transition hover:border-zinc-600">
      <div className="relative aspect-[9/14] w-full overflow-hidden bg-zinc-900">
        <Thumb reel={reel} className="h-full w-full transition group-hover:scale-[1.02]" />
        <div className="absolute top-2 left-2">
          <ScoreBadge reel={reel} />
        </div>
        {reel.source === "manual" && (
          <span className="absolute top-2 right-2 rounded bg-zinc-950/80 px-1.5 py-0.5 text-[10px] text-zinc-300">manual</span>
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-black/90 to-transparent px-2 pt-8 pb-2 text-xs font-medium">
          <span className="flex items-center gap-1">
            <Eye className="h-3.5 w-3.5" />
            {fmtNum(reel.views)}
          </span>
          <span className="flex items-center gap-1">
            <Heart className="h-3.5 w-3.5" />
            {fmtNum(reel.likes)}
          </span>
          <span className="flex items-center gap-1">
            <MessageCircle className="h-3.5 w-3.5" />
            {fmtNum(reel.comments)}
          </span>
        </div>
      </div>
      <div className="space-y-1 p-2.5">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate font-medium text-zinc-200">@{reel.owner || "unknown"}</span>
          <span className="shrink-0 text-zinc-500">{timeAgo(reel.posted_at)}</span>
        </div>
        <p className="line-clamp-2 text-xs text-zinc-400">{reel.caption || "No caption"}</p>
        {(reel.growthPerHour != null || reel.vph != null) && (
          <div className="text-[11px] text-zinc-500">
            {reel.growthPerHour != null ? `+${fmtNum(reel.growthPerHour)}/h since last refresh` : `${fmtNum(reel.vph)} views/h`}
          </div>
        )}
      </div>
    </button>
  );
}

export function AddToBoard({ reelId }: { reelId: string }) {
  const boards = useAsync(() => api<Board[]>("/boards"), []);
  const [done, setDone] = useState<string | null>(null);
  const add = async (board: Board) => {
    await api(`/boards/${board.id}/nodes`, {
      body: { type: "reel", x: 80 + Math.random() * 200, y: 80 + Math.random() * 200, data: { reelId } },
    });
    setDone(board.name);
  };
  if (done) return <span className="text-sm text-emerald-300">Added to “{done}”</span>;
  return (
    <select
      className="input w-auto py-1.5"
      value=""
      onChange={(e) => {
        const b = boards.data?.find((x) => x.id === e.target.value);
        if (b) add(b);
      }}
    >
      <option value="">＋ Add to board…</option>
      {boards.data?.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}

/** Full Reel details: stats, transcript (auto via Whisper, upload, or paste) and AI breakdown. */
export function ReelDetail({ reelId, onClose, onChanged }: { reelId: string; onClose: () => void; onChanged?: () => void }) {
  const reel = useAsync(() => api<Reel>(`/reels/${encodeURIComponent(reelId)}`), [reelId]);
  const [localBusy, setBusy] = useState<"" | "analyze" | "transcribe" | "upload" | "save">("");
  const [error, setError] = useState<unknown>(null);
  const [dismissedJobAt, setDismissedJobAt] = useState<number | undefined>();
  const [editingTranscript, setEditingTranscript] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Analyze/transcribe run on the server; the dialog just watches them and can be closed anytime.
  const job = reel.data?.job;
  const busy = localBusy || (job?.status === "running" ? job.kind : "");
  const jobError = job?.status === "error" && job.finishedAt !== dismissedJobAt ? jobErrorToApiError(job) : null;
  useEffect(() => {
    if (job?.status !== "running") return;
    const timer = setInterval(async () => {
      const next = await api<Reel>(`/reels/${encodeURIComponent(reelId)}`).catch(() => null);
      if (!next) return;
      reel.setData(next);
      if (next.job?.status !== "running") onChanged?.();
    }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status, job?.startedAt, reelId]);

  const act = async (kind: typeof busy, fn: () => Promise<Reel>) => {
    setBusy(kind);
    setError(null);
    try {
      reel.setData(await fn());
      onChanged?.();
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  };
  const id = encodeURIComponent(reelId);
  const startJob = (kind: "analyze" | "transcribe") =>
    act(kind, async () => {
      const next = await api<Reel>(`/reels/${id}/${kind}`, { method: "POST" });
      notifyJobStarted();
      return next;
    });
  const analyze = () => startJob("analyze");
  const transcribe = () => startJob("transcribe");
  const uploadFile = (file: File) => {
    const form = new FormData();
    form.append("file", file);
    act("upload", () => api<Reel>(`/reels/${id}/upload`, { form }));
  };
  const saveTranscript = () =>
    act("save", async () => {
      const r = await api<Reel>(`/reels/${id}`, { method: "PATCH", body: { transcript: editingTranscript ?? "" } });
      setEditingTranscript(null);
      return r;
    });

  const r = reel.data;
  return (
    <Modal title={r ? `Reel by @${r.owner || "unknown"}` : "Reel"} onClose={onClose} wide>
      <input
        ref={fileRef}
        type="file"
        accept="video/*,audio/*"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
      />
      {!r ? (
        reel.error ? <ErrorBox error={reel.error} /> : <Spinner />
      ) : (
        <div className="grid gap-5 md:grid-cols-[200px_1fr]">
          <div className="space-y-3">
            <Thumb reel={r} className="aspect-[9/14] w-full rounded-lg" />
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              {[
                ["Views", r.views],
                ["Likes", r.likes],
                ["Comments", r.comments],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-lg bg-zinc-800/60 p-2">
                  <div className="font-semibold text-zinc-100">{fmtNum(v as number | null)}</div>
                  <div className="text-zinc-500">{k}</div>
                </div>
              ))}
            </div>
            <div className="space-y-1 text-xs text-zinc-400">
              {r.score != null && (
                <div>
                  <ScoreBadge reel={r} /> vs @{r.owner}'s median {fmtNum(r.baseline)} {r.metric}
                </div>
              )}
              {r.vph != null && <div>{fmtNum(r.vph)} views/hour since posting</div>}
              {r.growthPerHour != null && <div>+{fmtNum(r.growthPerHour)} views/hour since last refresh</div>}
              <div>Posted {r.posted_at ? new Date(r.posted_at).toLocaleString() : "unknown"}</div>
              <div>
                Data: {r.source} · updated {timeAgo(r.updated_at)}
              </div>
              {r.music && <div>♪ {r.music}</div>}
            </div>
            <div className="flex flex-col gap-2">
              {r.url && (
                <a className="btn-ghost justify-center" href={r.url} target="_blank" rel="noreferrer">
                  Open on Instagram <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              <AddToBoard reelId={r.id} />
            </div>
          </div>

          <div className="min-w-0 space-y-4">
            {error || jobError ? (
              <ErrorBox
                error={error ?? jobError}
                onUpload={() => fileRef.current?.click()}
                onDismiss={() => {
                  setError(null);
                  setDismissedJobAt(job?.finishedAt);
                }}
              />
            ) : null}

            <section>
              <div className="label">Caption</div>
              <p className="max-h-32 overflow-y-auto text-sm whitespace-pre-wrap text-zinc-300">{r.caption || "No caption"}</p>
            </section>

            <section>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <div className="label mb-0">Transcript</div>
                <div className="flex flex-wrap gap-2">
                  {!r.transcript && (r.audio_url || r.video_url) && (
                    <button className="btn-ghost" disabled={!!busy} onClick={transcribe}>
                      {busy === "transcribe" ? <Spinner /> : <Mic className="h-4 w-4" />} Transcribe
                    </button>
                  )}
                  <button className="btn-ghost" disabled={!!busy} onClick={() => fileRef.current?.click()}>
                    {busy === "upload" ? <Spinner /> : <Upload className="h-4 w-4" />} Upload video
                  </button>
                  <button className="btn-ghost" disabled={!!busy} onClick={() => setEditingTranscript(r.transcript ?? "")}>
                    <Pencil className="h-4 w-4" /> Paste
                  </button>
                </div>
              </div>
              {editingTranscript != null ? (
                <div className="space-y-2">
                  <textarea
                    className="input h-32"
                    value={editingTranscript}
                    onChange={(e) => setEditingTranscript(e.target.value)}
                    placeholder="Paste what's said in the Reel…"
                  />
                  <div className="flex gap-2">
                    <button className="btn-primary" disabled={!!busy} onClick={saveTranscript}>
                      Save
                    </button>
                    <button className="btn-ghost" onClick={() => setEditingTranscript(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="max-h-40 overflow-y-auto text-sm whitespace-pre-wrap text-zinc-400">
                  {r.transcript ||
                    (r.audio_url || r.video_url
                      ? "Not transcribed yet. Analyze does it automatically."
                      : "No media file from the data source. Upload the video or paste the words.")}
                </p>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="label mb-0">Why it worked</div>
                <div className="flex gap-2">
                  {r.analysis && <CopyButton text={r.analysis} />}
                  <button className="btn-primary" disabled={!!busy} onClick={analyze}>
                    {busy === "analyze" ? <Spinner /> : <Sparkles className="h-4 w-4" />}
                    {r.analysis ? "Re-analyze" : "Analyze"}
                  </button>
                </div>
              </div>
              {busy === "analyze" && (
                <p className="text-sm text-zinc-500">
                  Transcribing and breaking it down in the background (10–30s). You can close this and keep working;
                  you'll get a notice when it's ready.
                </p>
              )}
              {r.analysis ? (
                <div className="max-h-[45vh] overflow-y-auto rounded-lg bg-zinc-950/60 p-3">
                  <Markdown>{r.analysis}</Markdown>
                </div>
              ) : (
                busy !== "analyze" && (
                  <p className="text-sm text-zinc-500">
                    Get the hook, structure, why it worked, and 3 versions adapted to your brand.
                  </p>
                )
              )}
            </section>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** The always-works fallback: type in what you see on Instagram. */
export function ManualReelForm({
  initialUrl = "",
  onClose,
  onCreated,
}: {
  initialUrl?: string;
  onClose: () => void;
  onCreated: (reel: Reel) => void;
}) {
  const [form, setForm] = useState({
    url: initialUrl,
    owner: "",
    caption: "",
    views: "",
    likes: "",
    comments: "",
    postedAt: "",
    transcript: "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      let reel = await api<Reel>("/reels/manual", { body: form });
      if (file) {
        const data = new FormData();
        data.append("file", file);
        reel = await api<Reel>(`/reels/${encodeURIComponent(reel.id)}/upload`, { form: data });
      }
      onCreated(reel);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add a Reel manually" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-zinc-400">
          Copy what you see on Instagram. Numbers like <code>12.5k</code> or <code>1.2m</code> work.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">Reel link</label>
            <input className="input" value={form.url} onChange={set("url")} placeholder="https://www.instagram.com/reel/…" />
          </div>
          <div>
            <label className="label">Creator @</label>
            <input className="input" value={form.owner} onChange={set("owner")} placeholder="@creator" />
          </div>
          <div>
            <label className="label">Posted on</label>
            <input className="input" type="date" value={form.postedAt} onChange={set("postedAt")} />
          </div>
          <div>
            <label className="label">Views</label>
            <input className="input" value={form.views} onChange={set("views")} placeholder="e.g. 250k" />
          </div>
          <div>
            <label className="label">Likes</label>
            <input className="input" value={form.likes} onChange={set("likes")} />
          </div>
          <div>
            <label className="label">Comments</label>
            <input className="input" value={form.comments} onChange={set("comments")} />
          </div>
          <div>
            <label className="label">Video/audio (optional)</label>
            <input
              className="input py-1.5 text-xs"
              type="file"
              accept="video/*,audio/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="col-span-2">
            <label className="label">Caption</label>
            <textarea className="input h-20" value={form.caption} onChange={set("caption")} />
          </div>
          {!file && (
            <div className="col-span-2">
              <label className="label">Transcript (optional)</label>
              <textarea className="input h-20" value={form.transcript} onChange={set("transcript")} placeholder="What's said in the Reel" />
            </div>
          )}
        </div>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy} onClick={submit}>
            {busy ? <Spinner /> : <LayoutGrid className="h-4 w-4" />} {file ? "Save & transcribe" : "Save Reel"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
