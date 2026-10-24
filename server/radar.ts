import { all, get, run, now, newId, tx, parseJson } from "./db.ts";
import { getSettings, setSettings } from "./settings.ts";
import { AppError, type Alternative } from "./errors.ts";
import { completeJson, complete, estimateTokens } from "./llm.ts";
import { brandBlock, CORE_RULES } from "./prompts.ts";
import { upsertReel, queryReels, reelToText, ensureTranscript, scoreReels, type ReelRow } from "./reels.ts";
import {
  sourceOrder,
  instagramAlternatives,
  metaFetchCreator,
  metaFetchHashtag,
  apifyFetchCreators,
  apifyFetchHashtag,
  type SourceName,
} from "./sources/instagram.ts";

type ItemResult = { name: string; ok: boolean; source?: SourceName; count: number; error?: string };

export type RefreshSummary = {
  at: number;
  creators: ItemResult[];
  hashtags: ItemResult[];
  reelsSaved: number;
  reportId?: string;
  reportError?: string;
  alternatives: Alternative[];
};

export const job = {
  running: false,
  startedAt: 0,
  log: [] as string[],
  last: null as RefreshSummary | null,
  error: null as string | null,
};

const log = (message: string) => {
  job.log.push(`${new Date().toLocaleTimeString()}  ${message}`);
  if (job.log.length > 200) job.log.shift();
};

export function startRefresh(opts: { usernames?: string[]; tags?: string[]; report?: boolean } = {}) {
  if (job.running) throw new AppError("A refresh is already running.", { status: 409 });
  const s = getSettings();
  if (!sourceOrder(s).length) {
    throw new AppError("No live Instagram data source is connected yet.", {
      hint: "Connect one in Settings. Until then you can add Reels manually.",
      alternatives: instagramAlternatives(s),
    });
  }
  job.running = true;
  job.startedAt = now();
  job.log = [];
  job.error = null;
  refresh(opts)
    .then((summary) => (job.last = summary))
    .catch((err) => {
      job.error = err instanceof Error ? err.message : String(err);
      log(`Refresh failed: ${job.error}`);
    })
    .finally(() => (job.running = false));
}

async function refresh(opts: { usernames?: string[]; tags?: string[]; report?: boolean }): Promise<RefreshSummary> {
  const s = getSettings();
  const order = sourceOrder(s);
  const creators = (opts.usernames ?? all<{ username: string }>("select username from creators").map((c) => c.username));
  const tags = opts.tags ?? all<{ tag: string }>("select tag from hashtags").map((h) => h.tag);
  log(`Refreshing ${creators.length} creator(s), ${tags.length} hashtag(s) via ${order.join(" → ")}`);

  let reelsSaved = 0;
  const creatorResults = new Map<string, ItemResult>();
  const creatorErrors = new Map<string, string[]>();
  let pending = [...creators];

  for (const source of order) {
    if (!pending.length) break;
    if (source === "meta") {
      const stillPending: string[] = [];
      for (const username of pending) {
        try {
          const { profile, reels } = await metaFetchCreator(s, username, s.reelsPerCreator);
          tx(() => {
            reels.forEach((r) => upsertReel(r));
            run(
              `update creators set full_name = ?, followers = ?, media_count = ?, profile_pic = ?,
                 last_fetched_at = ?, last_source = 'meta', last_error = null where username = ?`,
              profile.fullName,
              profile.followers,
              profile.mediaCount,
              profile.profilePic,
              now(),
              username,
            );
          });
          reelsSaved += reels.length;
          creatorResults.set(username, { name: username, ok: true, source, count: reels.length });
          log(`@${username}: ${reels.length} reels (Meta)`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          creatorErrors.set(username, [...(creatorErrors.get(username) ?? []), `Meta: ${message}`]);
          log(`@${username}: Meta failed: ${message}`);
          stillPending.push(username);
        }
      }
      pending = stillPending;
    } else {
      try {
        log(`Apify: fetching ${pending.length} creator(s)… (usually 1–3 min)`);
        const { byOwner, errors } = await apifyFetchCreators(s, pending, s.reelsPerCreator, log);
        const stillPending: string[] = [];
        for (const username of pending) {
          const reels = byOwner.get(username) ?? [];
          const error = errors.get(username);
          if (error && !reels.length) {
            creatorErrors.set(username, [...(creatorErrors.get(username) ?? []), `Apify: ${error}`]);
            log(`@${username}: Apify failed: ${error}`);
            stillPending.push(username);
            continue;
          }
          tx(() => {
            reels.forEach((r) => upsertReel(r));
            run(
              "update creators set last_fetched_at = ?, last_source = 'apify', last_error = ? where username = ?",
              now(),
              reels.length ? null : `No Reels in the last ${s.lookbackDays} days (or the account is private).`,
              username,
            );
          });
          reelsSaved += reels.length;
          creatorResults.set(username, { name: username, ok: true, source, count: reels.length });
          log(`@${username}: ${reels.length} reels (Apify)`);
        }
        pending = stillPending;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`Apify failed: ${message}`);
        for (const username of pending) {
          creatorErrors.set(username, [...(creatorErrors.get(username) ?? []), `Apify: ${message}`]);
        }
      }
    }
  }
  for (const username of pending) {
    const error = (creatorErrors.get(username) ?? ["No source could fetch this account."]).join(" | ");
    run("update creators set last_error = ? where username = ?", error, username);
    creatorResults.set(username, { name: username, ok: false, count: 0, error });
  }

  const hashtagResults: ItemResult[] = [];
  for (const tag of tags) {
    const errors: string[] = [];
    let done = false;
    for (const source of order) {
      try {
        const reels =
          source === "meta"
            ? await metaFetchHashtag(s, tag, s.reelsPerHashtag)
            : await apifyFetchHashtag(s, tag, s.reelsPerHashtag, log);
        tx(() => {
          reels.forEach((r) => upsertReel(r, tag));
          run(
            "update hashtags set last_fetched_at = ?, last_source = ?, last_error = null where tag = ?",
            now(),
            source,
            tag,
          );
        });
        reelsSaved += reels.length;
        hashtagResults.push({ name: tag, ok: true, source, count: reels.length });
        log(`#${tag}: ${reels.length} reels (${source})`);
        done = true;
        break;
      } catch (err) {
        errors.push(`${source}: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (!done) {
      run("update hashtags set last_error = ? where tag = ?", errors.join(" | "), tag);
      hashtagResults.push({ name: tag, ok: false, count: 0, error: errors.join(" | ") });
      log(`#${tag}: failed: ${errors.join(" | ")}`);
    }
  }

  setSettings({ lastRefreshAt: now() });
  const summary: RefreshSummary = {
    at: now(),
    creators: [...creatorResults.values()],
    hashtags: hashtagResults,
    reelsSaved,
    alternatives: [...creatorResults.values(), ...hashtagResults].some((r) => !r.ok)
      ? instagramAlternatives(s)
      : [],
  };

  const wantReport = opts.report ?? s.autoReport;
  if (wantReport && reelsSaved > 0) {
    try {
      log("Writing ideas report…");
      summary.reportId = await generateReport({});
      log("Ideas report ready.");
    } catch (err) {
      summary.reportError = err instanceof Error ? err.message : String(err);
      log(`Report failed: ${summary.reportError}`);
    }
  }
  run(
    "insert into refresh_log (at, ok, summary) values (?, ?, ?)",
    summary.at,
    summary.creators.every((c) => c.ok) && summary.hashtags.every((h) => h.ok) ? 1 : 0,
    JSON.stringify(summary),
  );
  log(`Done. ${reelsSaved} reels updated.`);
  return summary;
}

/* --------------------------------------------------------------- Reports */

type ReportJson = {
  headline?: string;
  patterns?: { name?: string; explanation?: string; reelIds?: string[] }[];
  ideas?: { title?: string; hook?: string; format?: string; angle?: string; why?: string; basedOn?: string[] }[];
};

/** Pick the top outliers, transcribe the best few, and ask the AI for patterns + ideas. Returns the report id. */
export async function generateReport({ days, top = 10 }: { days?: number; top?: number }) {
  const s = getSettings();
  const window = days ?? Math.min(s.lookbackDays, 14);
  let picks = queryReels({ days: window, sort: "outlier", limit: 60 });
  if (picks.length < 4) picks = queryReels({ days: s.lookbackDays, sort: "outlier", limit: 60 });
  if (!picks.length) {
    throw new AppError("No Reels to analyze yet. Add creators to the watchlist and refresh.", {
      alternatives: instagramAlternatives(s),
    });
  }
  picks = picks.slice(0, top);

  for (const reel of picks.slice(0, s.autoTranscribeTop)) {
    if (reel.transcript) continue;
    try {
      await ensureTranscript(reel.id);
      log(`Transcribed ${reel.id} (@${reel.owner})`);
    } catch (err) {
      log(`Skipped transcript for ${reel.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  const fresh = scoreReels(picks.map((p) => get<ReelRow>("select * from reels where id = ?", p.id)!));

  const brand = brandBlock(s.brand);
  const perReelChars = Math.max(400, Math.floor(((s.contextBudget - estimateTokens(brand) - 500) * 4) / fresh.length));
  const material = fresh.map((r) => reelToText(r, perReelChars)).join("\n\n");

  const result = await completeJson<ReportJson>({
    maxTokens: 2500,
    temperature: 0.8,
    reasoning: "medium",
    messages: [
      { role: "system", content: `${CORE_RULES}\n\n${brand}` },
      {
        role: "user",
        content: `Here are the top-performing recent Reels from the creators and hashtags I track (sorted by outlier score).

${material}

Find what's working right now and turn it into ideas for MY brand. Reply as JSON only:
{
  "headline": "one sentence: the biggest thing working in my niche right now",
  "patterns": [{"name": "short label", "explanation": "what the pattern is and why it's outperforming, with numbers", "reelIds": ["ids of reels showing it"]}],
  "ideas": [{"title": "working title", "hook": "exact first line to say/show in the first 2 seconds", "format": "e.g. talking head + b-roll, green screen, POV skit, carousel-to-reel", "angle": "what makes my version different", "why": "which pattern/reel this builds on and why it should work for my audience", "basedOn": ["reel ids"]}]
}
Give 3-5 patterns and 8 ideas. Only use reel ids from the list above.`,
      },
    ],
  });

  const validIds = new Set(fresh.map((r) => r.id));
  const ids = (list?: string[]) => (list ?? []).filter((id) => validIds.has(id));
  const reelLink = (id: string) => {
    const r = fresh.find((x) => x.id === id);
    return r ? `[@${r.owner || "reel"}${r.score ? ` ${r.score.toFixed(1)}×` : ""}](${r.url})` : id;
  };
  const patterns = (result.patterns ?? []).filter((p) => p.name);
  const ideas = (result.ideas ?? []).filter((i) => i.title);

  const body = [
    result.headline ? `> ${result.headline}` : "",
    "## What's working",
    ...patterns.map((p) => `**${p.name}.** ${p.explanation ?? ""} ${ids(p.reelIds).map(reelLink).join(", ")}`),
    "## Top Reels analyzed",
    ...fresh.map(
      (r) =>
        `- [@${r.owner || "unknown"}](${r.url}): ${r.views != null ? `${r.views.toLocaleString()} views` : `${r.likes ?? 0} likes`}` +
        `${r.score ? ` · **${r.score.toFixed(1)}×** outlier` : ""} · ${(r.caption ?? "").slice(0, 90).replace(/\s+/g, " ")}`,
    ),
  ].join("\n\n");

  const reportId = newId();
  const created = now();
  tx(() => {
    run(
      "insert into reports (id, created_at, title, body, data) values (?, ?, ?, ?, ?)",
      reportId,
      created,
      `Ideas report · ${new Date(created).toLocaleDateString()}`,
      body,
      JSON.stringify({ reelIds: fresh.map((r) => r.id), headline: result.headline ?? "" }),
    );
    for (const idea of ideas) {
      run(
        `insert into ideas (id, report_id, created_at, title, hook, format, angle, why, based_on)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(),
        reportId,
        created,
        idea.title!,
        idea.hook ?? "",
        idea.format ?? "",
        idea.angle ?? "",
        idea.why ?? "",
        JSON.stringify(ids(idea.basedOn)),
      );
    }
  });
  return reportId;
}

type IdeaRow = { id: string; title: string; hook: string; format: string; angle: string; why: string; based_on: string };

export async function writeScript(ideaId: string, extra = "") {
  const s = getSettings();
  const idea = get<IdeaRow>("select * from ideas where id = ?", ideaId);
  if (!idea) throw new AppError("Idea not found.", { status: 404 });
  const sources = parseJson<string[]>(idea.based_on, [])
    .map((id) => get<ReelRow>("select * from reels where id = ?", id))
    .filter((r): r is ReelRow => Boolean(r));
  const reference = sources.length
    ? `Reference Reels this idea builds on:\n${scoreReels(sources).map((r) => reelToText(r, 1500)).join("\n\n")}`
    : "";
  const { text } = await complete({
    maxTokens: 2000,
    messages: [
      { role: "system", content: `${CORE_RULES}\n\n${brandBlock(s.brand)}` },
      {
        role: "user",
        content: `Write a ready-to-film Instagram Reel script for this idea.

Title: ${idea.title}
Hook: ${idea.hook}
Format: ${idea.format}
Angle: ${idea.angle}
Why: ${idea.why}
${extra ? `My notes: ${extra}\n` : ""}
${reference}

Include:
## Hook (0-3s): words to say + on-screen text + first shot
## Script: timestamped beats (aim 20-45s), with what to say, on-screen text, and B-roll/shot for each beat
## Retention tricks: pattern interrupts / open loops used
## Caption: ready to paste, with a CTA that fits my offers
## Hashtags: 5-8, niche-specific
## Audio & editing notes`,
      },
    ],
  });
  run("update ideas set script = ?, status = case when status = 'new' then 'scripting' else status end where id = ?", text, ideaId);
  return text;
}

/* ------------------------------------------------------------- Scheduler */

export function startScheduler() {
  const tick = () => {
    const s = getSettings();
    if (!s.autoRefreshHours || job.running || !sourceOrder(s).length) return;
    const hasWatchlist = (get<{ n: number }>("select (select count(*) from creators) + (select count(*) from hashtags) n")?.n ?? 0) > 0;
    if (!hasWatchlist) return;
    if (now() - s.lastRefreshAt >= s.autoRefreshHours * 3_600_000) {
      try {
        startRefresh({});
        console.log("[scheduler] auto-refresh started");
      } catch (err) {
        console.warn("[scheduler]", err);
      }
    }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, 10 * 60_000);
}
