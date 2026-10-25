import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Hash,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
  UserRound,
  X,
  Radar as RadarIcon,
} from "lucide-react";
import { api, fmtNum, navigate, timeAgo, type Creator, type Hashtag, type RadarStatus, type Reel } from "../api.ts";
import { useStatus } from "../status.ts";
import { Alternatives, Empty, ErrorBox, IconButton, Spinner, useAsync } from "../components/ui.tsx";
import { ManualReelForm, ReelCard, ReelDetail } from "../components/reels.tsx";
import { ChatPanel } from "../components/ChatPanel.tsx";

const DAYS = [7, 14, 30, 90];
const SORTS = [
  ["outlier", "Outlier score"],
  ["velocity", "Velocity"],
  ["views", "Most views"],
  ["recent", "Newest"],
] as const;

function WatchItem({
  label,
  sub,
  error,
  fetched,
  onRemove,
  onClick,
  active,
}: {
  label: string;
  sub: string;
  error: string | null;
  fetched: number | null;
  onRemove: () => void;
  onClick: () => void;
  active: boolean;
}) {
  // Status is shown by icon shape (and named for screen readers), not by color alone.
  const state = error
    ? { Icon: AlertCircle, tone: "text-danger", text: `Last refresh failed: ${error}` }
    : fetched
      ? { Icon: CheckCircle2, tone: "text-success", text: `Fetched ${timeAgo(fetched)}` }
      : { Icon: Clock, tone: "text-fg-3", text: "Not fetched yet. Press Refresh now." };
  return (
    <div
      className={`group flex items-center gap-1.5 rounded-lg py-0.5 pr-0.5 pl-2 text-sm ${active ? "bg-surface-3" : "hover:bg-surface-2"}`}
      title={state.text}
    >
      <state.Icon aria-hidden className={`h-3.5 w-3.5 shrink-0 ${state.tone}`} />
      <button
        className="min-w-0 flex-1 truncate py-1 text-left"
        aria-pressed={active}
        aria-label={`${label}. ${state.text}. ${active ? "Showing only this." : "Show only this."}`}
        onClick={onClick}
      >
        {label}
      </button>
      <span className="text-xs text-fg-3 tabular-nums">{sub}</span>
      <IconButton
        label={`Remove ${label}`}
        tone="danger"
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        onClick={onRemove}
      >
        <X className="h-4 w-4" />
      </IconButton>
    </div>
  );
}

export function RadarPage() {
  const { status, refreshStatus } = useStatus();
  const [days, setDays] = useState(14);
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>("outlier");
  const [owner, setOwner] = useState("");
  const [hashtag, setHashtag] = useState("");
  const [openReel, setOpenReel] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [creatorInput, setCreatorInput] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [radar, setRadar] = useState<RadarStatus | null>(null);
  const [reporting, setReporting] = useState(false);
  const wasRunning = useRef(false);

  const reels = useAsync(
    () =>
      api<Reel[]>(
        `/radar/reels?days=${days}&sort=${sort}${owner ? `&owner=${owner}` : ""}${hashtag ? `&hashtag=${hashtag}` : ""}`,
      ),
    [days, sort, owner, hashtag],
  );
  const creators = useAsync(() => api<Creator[]>("/creators"), []);
  const hashtags = useAsync(() => api<Hashtag[]>("/hashtags"), []);

  const pollStatus = () => api<RadarStatus>("/radar/status").then(setRadar).catch(() => {});
  useEffect(() => {
    pollStatus();
  }, []);
  useEffect(() => {
    if (!radar?.running) {
      if (wasRunning.current) {
        reels.reload();
        creators.reload();
        hashtags.reload();
        refreshStatus();
      }
      wasRunning.current = false;
      return;
    }
    wasRunning.current = true;
    const t = setInterval(pollStatus, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radar?.running]);

  const refresh = async () => {
    setError(null);
    try {
      await api("/radar/refresh", { body: {} });
      await pollStatus();
    } catch (e) {
      setError(e);
    }
  };

  const report = async () => {
    setError(null);
    setReporting(true);
    try {
      const { id } = await api<{ id: string }>("/radar/report", { body: { days } });
      navigate(`#/ideas/report-${id}`);
    } catch (e) {
      setError(e);
    } finally {
      setReporting(false);
    }
  };

  const addCreators = async () => {
    if (!creatorInput.trim()) return;
    setError(null);
    try {
      await api("/creators", { body: { usernames: creatorInput } });
      setCreatorInput("");
      creators.reload();
    } catch (e) {
      setError(e);
    }
  };
  const addTags = async () => {
    if (!tagInput.trim()) return;
    setError(null);
    try {
      await api("/hashtags", { body: { tags: tagInput } });
      setTagInput("");
      hashtags.reload();
    } catch (e) {
      setError(e);
    }
  };

  const noSource = status && !status.meta && !status.apify;
  const failed = radar?.last ? [...radar.last.creators, ...radar.last.hashtags].filter((r) => !r.ok) : [];

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1400px] space-y-6 p-6">
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Trend Radar</h1>
              <p className="text-sm text-fg-2">
                Reels from your watchlist, ranked by how far they beat that creator's normal. Last refresh{" "}
                {timeAgo(radar?.lastRefreshAt ?? status?.lastRefreshAt)}
                {radar?.autoRefreshHours ? ` · auto every ${radar.autoRefreshHours}h` : " · auto-refresh off"}.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={() => setManual(true)}>
                <Plus className="h-4 w-4" /> Add Reel manually
              </button>
              <button className="btn-ghost" onClick={() => setChatOpen(!chatOpen)}>
                <MessageSquare className="h-4 w-4" /> Ask the Radar
              </button>
              <button className="btn-ghost" disabled={reporting || !reels.data?.length} onClick={report}>
                {reporting ? <Spinner /> : <Sparkles className="h-4 w-4" />} {reporting ? "Writing report…" : "Write ideas report"}
              </button>
              <button className="btn-primary" disabled={radar?.running || !!noSource} onClick={refresh}>
                <RefreshCw className={`h-4 w-4 ${radar?.running ? "animate-spin" : ""}`} />
                {radar?.running ? "Refreshing…" : "Refresh now"}
              </button>
            </div>
          </header>

          {noSource && (
            <section className="card space-y-4 p-5">
              <div>
                <h2 className="text-lg font-semibold">Connect a live Instagram source</h2>
                <p className="text-sm text-fg-2">
                  Instagram doesn't give free public access to other creators' Reels, so Pollen uses one of these. Until one is
                  connected you can still add Reels manually and use every AI feature.
                </p>
              </div>
              <Alternatives
                alternatives={[
                  ...(status?.alternatives.filter((a) => a.id !== "groq-key") ?? []),
                  {
                    id: "manual",
                    title: "Add Reels manually",
                    detail: "Paste the caption and numbers, optionally upload the video for a free transcript.",
                    cost: "Free · no setup",
                    action: "manual-reel",
                  },
                ]}
                onManual={() => setManual(true)}
              />
            </section>
          )}
          {status && !status.llm && (
            <ErrorBox error={{ message: "Add your Groq API key to unlock analysis, reports and chat." }} />
          )}
          {error ? <ErrorBox error={error} onManual={() => setManual(true)} onDismiss={() => setError(null)} /> : null}

          {radar?.running && (
            <section className="card p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Spinner /> Fetching live data… you can keep using the app.
              </div>
              <pre className="max-h-40 overflow-y-auto text-xs whitespace-pre-wrap text-fg-2">{radar.log.join("\n")}</pre>
            </section>
          )}
          {!radar?.running && radar?.error && <ErrorBox error={{ message: `Last refresh failed: ${radar.error}` }} />}
          {!radar?.running && failed.length > 0 && (
            <section className="card space-y-3 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-fg">
                <AlertTriangle aria-hidden className="h-4 w-4 shrink-0 text-danger" />
                {failed.length} item(s) couldn't be fetched live on the last refresh
              </div>
              <ul className="space-y-1 text-sm text-fg-2">
                {failed.map((f) => (
                  <li key={f.name}>
                    <span className="text-fg">{radar!.last!.creators.includes(f) ? `@${f.name}` : `#${f.name}`}</span>:{" "}
                    {f.error}
                  </li>
                ))}
              </ul>
              {radar?.last?.alternatives.length ? (
                <Alternatives alternatives={radar.last.alternatives} onManual={() => setManual(true)} compact />
              ) : null}
            </section>
          )}
          {!radar?.running && radar?.last?.reportError && (
            <ErrorBox error={{ message: `Auto ideas report failed: ${radar.last.reportError}` }} />
          )}

          <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
            <aside className="space-y-5">
              <section className="card p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <UserRound className="h-4 w-4" /> Creators
                </div>
                <div className="mb-2 flex gap-1.5">
                  <input
                    className="input py-1.5"
                    placeholder="@username, @another"
                    value={creatorInput}
                    onChange={(e) => setCreatorInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addCreators()}
                  />
                  <button className="btn-ghost px-2" onClick={addCreators}>
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                {creators.data?.length ? (
                  <div className="max-h-80 overflow-y-auto">
                    {creators.data.map((c) => (
                      <WatchItem
                        key={c.username}
                        label={`@${c.username}`}
                        sub={c.followers ? fmtNum(c.followers) : String(c.reel_count)}
                        error={c.last_error}
                        fetched={c.last_fetched_at}
                        active={owner === c.username}
                        onClick={() => {
                          setHashtag("");
                          setOwner(owner === c.username ? "" : c.username);
                        }}
                        onRemove={async () => {
                          await api(`/creators/${c.username}`, { method: "DELETE" });
                          creators.reload();
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="px-1 text-xs text-fg-3">
                    Add 5–20 creators in your niche, including ones bigger and smaller than you.
                  </p>
                )}
              </section>

              <section className="card p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Hash className="h-4 w-4" /> Hashtags
                </div>
                <div className="mb-2 flex gap-1.5">
                  <input
                    className="input py-1.5"
                    placeholder="#hashtag"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addTags()}
                  />
                  <button className="btn-ghost px-2" onClick={addTags}>
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                {hashtags.data?.length ? (
                  hashtags.data.map((h) => (
                    <WatchItem
                      key={h.tag}
                      label={`#${h.tag}`}
                      sub={String(h.reel_count)}
                      error={h.last_error}
                      fetched={h.last_fetched_at}
                      active={hashtag === h.tag}
                      onClick={() => {
                        setOwner("");
                        setHashtag(hashtag === h.tag ? "" : h.tag);
                      }}
                      onRemove={async () => {
                        await api(`/hashtags/${h.tag}`, { method: "DELETE" });
                        hashtags.reload();
                      }}
                    />
                  ))
                ) : (
                  <p className="px-1 text-xs text-fg-3">Find breakout Reels from creators you don't follow yet.</p>
                )}
              </section>
            </aside>

            <section className="min-w-0 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-lg border border-line bg-surface-2 p-0.5">
                  {DAYS.map((d) => (
                    <button
                      key={d}
                      className={`rounded-md px-3 py-1 text-sm ${days === d ? "bg-surface text-fg shadow-sm" : "text-fg-2 hover:text-fg"}`}
                      aria-pressed={days === d}
                      onClick={() => setDays(d)}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
                <select className="input w-auto py-1.5" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                  {SORTS.map(([v, l]) => (
                    <option key={v} value={v}>
                      Sort: {l}
                    </option>
                  ))}
                </select>
                {(owner || hashtag) && (
                  <button className="btn-ghost" title="Clear filter" onClick={() => (setOwner(""), setHashtag(""))}>
                    {owner ? `@${owner}` : `#${hashtag}`} <X className="h-3.5 w-3.5" />
                  </button>
                )}
                <span className="ml-auto text-xs text-fg-3">
                  {reels.data?.length ?? 0} Reels · score = views ÷ creator's median
                </span>
              </div>

              {reels.loading && !reels.data ? (
                <Spinner />
              ) : reels.data?.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {reels.data.map((r) => (
                    <ReelCard key={r.id} reel={r} onOpen={() => setOpenReel(r.id)} />
                  ))}
                </div>
              ) : (
                <Empty icon={<RadarIcon className="h-8 w-8" />} title={`No Reels in the last ${days} days yet`}>
                  {noSource
                    ? "Connect Apify or Meta above, add creators, then press Refresh. Or add a Reel manually."
                    : creators.data?.length
                      ? "Press Refresh now to pull their latest Reels."
                      : "Add some creators on the left, then press Refresh now."}
                </Empty>
              )}
            </section>
          </div>
        </div>
      </div>

      {chatOpen && (
        <div className="w-[420px] shrink-0 border-l border-line">
          <ChatPanel chatId="radar" scope="radar" days={days} title="Ask the Radar" onClose={() => setChatOpen(false)} />
        </div>
      )}
      {openReel && <ReelDetail reelId={openReel} onClose={() => setOpenReel(null)} onChanged={reels.reload} />}
      {manual && (
        <ManualReelForm
          onClose={() => setManual(false)}
          onCreated={(r) => {
            setManual(false);
            reels.reload();
            creators.reload();
            setOpenReel(r.id);
          }}
        />
      )}
    </div>
  );
}
