import { useState } from "react";
import { FileText, Film, Lightbulb, Plus, Sparkles, Trash2, ScrollText } from "lucide-react";
import { api, timeAgo, type Idea, type IdeaStatus, type Report } from "../api.ts";
import { CopyButton, Empty, ErrorBox, IconButton, Markdown, Modal, Spinner, useAsync } from "../components/ui.tsx";
import { ReelDetail } from "../components/reels.tsx";

const STATUSES: IdeaStatus[] = ["new", "saved", "scripting", "filmed", "posted", "dismissed"];
const STATUS_TONE: Record<IdeaStatus, string> = {
  new: "bg-info/10 text-info",
  saved: "bg-accent/25 text-fg",
  scripting: "bg-violet-500/15 text-violet-700 dark:text-violet-200",
  filmed: "bg-success/10 text-success",
  posted: "bg-success/20 text-success",
  dismissed: "bg-surface-3 text-fg-2",
};

function ScriptModal({ idea, onClose, onSaved }: { idea: Idea; onClose: () => void; onSaved: (i: Idea) => void }) {
  const [current, setCurrent] = useState(idea);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api<Idea>(`/ideas/${idea.id}/script`, { body: { notes } });
      setCurrent(updated);
      onSaved(updated);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={current.title} onClose={onClose} wide>
      <div className="space-y-4">
        {current.script ? (
          <div className="max-h-[55vh] overflow-y-auto rounded-lg bg-canvas/60 p-4">
            <Markdown>{current.script}</Markdown>
          </div>
        ) : (
          <p className="text-sm text-fg-2">
            Pollen writes a timestamped script with hook, beats, on-screen text, caption and hashtags, based on the Reels
            this idea came from and your Brand Memory.
          </p>
        )}
        <ErrorBox error={error} />
        <div>
          <label className="label">Notes for the script (optional)</label>
          <input
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. make it 20 seconds, film it in my car, mention my free guide"
          />
        </div>
        <div className="flex justify-end gap-2">
          {current.script && <CopyButton text={current.script} label="Copy script" />}
          <button className="btn-primary" disabled={busy} onClick={generate}>
            {busy ? <Spinner /> : <Sparkles className="h-4 w-4" />} {current.script ? "Rewrite" : "Write script"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function IdeaCard({
  idea,
  onChange,
  onOpenReel,
  onScript,
}: {
  idea: Idea;
  onChange: (i: Idea | null) => void;
  onOpenReel: (id: string) => void;
  onScript: () => void;
}) {
  const basedOn: string[] = JSON.parse(idea.based_on || "[]");
  const setStatus = async (status: IdeaStatus) => onChange(await api<Idea>(`/ideas/${idea.id}`, { method: "PATCH", body: { status } }));
  return (
    <div className="card space-y-2.5 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-fg">{idea.title}</h3>
        <select
          aria-label="Status"
          className={`rounded-md border-0 px-2 py-1 text-xs font-medium capitalize ${STATUS_TONE[idea.status]}`}
          value={idea.status}
          onChange={(e) => setStatus(e.target.value as IdeaStatus)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s} className="bg-surface text-fg">
              {s}
            </option>
          ))}
        </select>
      </div>
      {idea.hook && <blockquote className="border-l-2 border-line-strong pl-3 text-sm text-fg italic">“{idea.hook}”</blockquote>}
      <dl className="grid gap-1.5 text-sm">
        {idea.format && (
          <div>
            <dt className="inline text-fg-3">Format: </dt>
            <dd className="inline text-fg-2">{idea.format}</dd>
          </div>
        )}
        {idea.angle && (
          <div>
            <dt className="inline text-fg-3">Angle: </dt>
            <dd className="inline text-fg-2">{idea.angle}</dd>
          </div>
        )}
        {idea.why && (
          <div>
            <dt className="inline text-fg-3">Why: </dt>
            <dd className="inline text-fg-2">{idea.why}</dd>
          </div>
        )}
      </dl>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button className="btn-primary" onClick={onScript}>
          <ScrollText className="h-4 w-4" /> {idea.script ? "View script" : "Write script"}
        </button>
        {basedOn.map((id, i) => (
          <button key={id} className="btn-ghost px-2 py-1 text-xs" onClick={() => onOpenReel(id)}>
            <Film aria-hidden className="h-3.5 w-3.5" /> Source Reel{basedOn.length > 1 ? ` ${i + 1}` : ""}
          </button>
        ))}
        <span className="ml-auto text-xs text-fg-3">{timeAgo(idea.created_at)}</span>
        <IconButton
          label="Delete idea"
          tone="danger"
          onClick={async () => {
            await api(`/ideas/${idea.id}`, { method: "DELETE" });
            onChange(null);
          }}
        >
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}

function NewIdeaModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ title: "", hook: "", format: "", angle: "" });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal title="New idea" onClose={onClose}>
      <div className="space-y-3">
        {(["title", "hook", "format", "angle"] as const).map((k) => (
          <div key={k}>
            <label className="label">{k}</label>
            <input className="input" value={form[k]} onChange={set(k)} />
          </div>
        ))}
        <div className="flex justify-end">
          <button
            className="btn-primary"
            disabled={!form.title.trim()}
            onClick={async () => {
              await api("/ideas", { body: form });
              onCreated();
            }}
          >
            Save idea
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function IdeasPage({ param }: { param?: string }) {
  const initialReport = param?.startsWith("report-") ? param.slice(7) : null;
  const [tab, setTab] = useState<"ideas" | "reports">(initialReport ? "reports" : "ideas");
  const [filter, setFilter] = useState<IdeaStatus | "">("");
  const [selectedReport, setSelectedReport] = useState<string | null>(initialReport);
  const [openReel, setOpenReel] = useState<string | null>(null);
  const [scriptIdea, setScriptIdea] = useState<Idea | null>(null);
  const [creating, setCreating] = useState(false);

  const ideas = useAsync(() => api<Idea[]>(`/ideas${filter ? `?status=${filter}` : ""}`), [filter]);
  const reports = useAsync(() => api<Report[]>("/reports"), []);
  const reportId = selectedReport ?? reports.data?.[0]?.id ?? null;
  const report = useAsync(() => (reportId ? api<Report>(`/reports/${reportId}`) : Promise.resolve(null)), [reportId]);

  const replaceIdea = (id: string, next: Idea | null) => {
    ideas.setData((list) => (list ?? []).flatMap((i) => (i.id === id ? (next ? [next] : []) : [i])));
    report.setData((r) =>
      r ? { ...r, ideas: (r.ideas ?? []).flatMap((i) => (i.id === id ? (next ? [next] : []) : [i])) } : r,
    );
  };

  const ideaGrid = (list: Idea[]) => (
    <div className="grid gap-3 lg:grid-cols-2">
      {list.map((i) => (
        <IdeaCard
          key={i.id}
          idea={i}
          onChange={(next) => replaceIdea(i.id, next)}
          onOpenReel={setOpenReel}
          onScript={() => setScriptIdea(i)}
        />
      ))}
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Ideas</h1>
          <p className="text-sm text-fg-2">
            Generated from what's outperforming on your Radar. Move them through your pipeline as you film.
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-lg border border-line bg-surface-2 p-0.5">
            {(["ideas", "reports"] as const).map((t) => (
              <button
                key={t}
                className={`rounded-md px-3 py-1 text-sm capitalize ${tab === t ? "bg-surface text-fg shadow-sm" : "text-fg-2 hover:text-fg"}`}
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <button className="btn-ghost" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New idea
          </button>
        </div>
      </header>

      {tab === "ideas" ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            {(["", ...STATUSES] as const).map((s) => (
              <button
                key={s || "all"}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${
                  filter === s ? "bg-fg text-canvas" : "bg-surface-2 text-fg-2 hover:bg-surface-3"
                }`}
                onClick={() => setFilter(s)}
              >
                {s || "All active"}
              </button>
            ))}
          </div>
          {ideas.error ? <ErrorBox error={ideas.error} /> : null}
          {ideas.data?.length ? (
            ideaGrid(ideas.data)
          ) : ideas.loading ? (
            <Spinner />
          ) : (
            <Empty icon={<Lightbulb className="h-8 w-8" />} title="No ideas here yet">
              Refresh the Trend Radar and press “Ideas report”, or turn on auto-reports in Settings.
            </Empty>
          )}
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          <aside className="space-y-1">
            {reports.data?.length ? (
              reports.data.map((r) => (
                <button
                  key={r.id}
                  className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${
                    r.id === reportId ? "bg-surface-3 text-fg" : "text-fg-2 hover:bg-surface-2"
                  }`}
                  onClick={() => setSelectedReport(r.id)}
                >
                  <div className="font-medium">{r.title}</div>
                  <div className="line-clamp-2 text-xs text-fg-3">{r.headline}</div>
                </button>
              ))
            ) : (
              <p className="text-sm text-fg-3">No reports yet.</p>
            )}
          </aside>
          <section className="min-w-0 space-y-5">
            {report.data ? (
              <>
                <div className="card p-5">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="flex items-center gap-2 text-lg font-semibold">
                      <FileText className="h-5 w-5" /> {report.data.title}
                    </h2>
                    <div className="flex gap-2">
                      <CopyButton text={report.data.body ?? ""} />
                      <button
                        className="btn-danger" aria-label="Delete report" title="Delete report"
                        onClick={async () => {
                          await api(`/reports/${report.data!.id}`, { method: "DELETE" });
                          setSelectedReport(null);
                          reports.reload();
                          ideas.reload();
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <Markdown>{report.data.body ?? ""}</Markdown>
                </div>
                <h3 className="font-semibold">Ideas from this report</h3>
                {ideaGrid(report.data.ideas ?? [])}
              </>
            ) : report.loading ? (
              <Spinner />
            ) : (
              <Empty icon={<FileText className="h-8 w-8" />} title="No report selected">
                Reports are written after each Radar refresh (if enabled), or on demand from the Radar.
              </Empty>
            )}
          </section>
        </div>
      )}

      {openReel && <ReelDetail reelId={openReel} onClose={() => setOpenReel(null)} />}
      {scriptIdea && (
        <ScriptModal idea={scriptIdea} onClose={() => setScriptIdea(null)} onSaved={(i) => replaceIdea(i.id, i)} />
      )}
      {creating && (
        <NewIdeaModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setTab("ideas");
            ideas.reload();
          }}
        />
      )}
    </div>
  );
}
