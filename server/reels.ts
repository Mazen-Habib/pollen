import { all, get, run, now } from "./db.ts";
import { getSettings } from "./settings.ts";
import { AppError, ALT } from "./errors.ts";
import { complete, transcribe, WHISPER_MAX_BYTES } from "./llm.ts";
import { brandBlock, CORE_RULES } from "./prompts.ts";
import type { NormalizedReel } from "./sources/instagram.ts";

export type ReelRow = {
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
  source: string;
  via_hashtag: string | null;
  first_seen_at: number;
  updated_at: number;
  transcript: string | null;
  analysis: string | null;
  analyzed_at: number | null;
};

export type ScoredReel = ReelRow & {
  metric: "views" | "likes" | null;
  baseline: number | null; // the owner's median of `metric` (other reels)
  score: number | null; // metric / baseline
  ageHours: number | null;
  vph: number | null; // views per hour since posting
  growthPerHour: number | null; // views gained per hour between the last two refreshes
  viewsPerFollower: number | null;
  followers: number | null;
};

/** Insert or update a Reel, keeping previously-collected transcript/analysis, and record a stats snapshot. */
export function upsertReel(r: NormalizedReel, viaHashtag?: string) {
  const t = now();
  run(
    `insert into reels (id, url, owner, caption, thumbnail, video_url, audio_url, posted_at, duration, views, likes,
       comments, music, source, via_hashtag, first_seen_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set
       url = coalesce(nullif(excluded.url, ''), reels.url),
       owner = coalesce(nullif(excluded.owner, ''), reels.owner),
       caption = coalesce(nullif(excluded.caption, ''), reels.caption),
       thumbnail = coalesce(excluded.thumbnail, reels.thumbnail),
       video_url = coalesce(excluded.video_url, reels.video_url),
       audio_url = coalesce(excluded.audio_url, reels.audio_url),
       posted_at = coalesce(excluded.posted_at, reels.posted_at),
       duration = coalesce(excluded.duration, reels.duration),
       views = coalesce(excluded.views, reels.views),
       likes = coalesce(excluded.likes, reels.likes),
       comments = coalesce(excluded.comments, reels.comments),
       music = coalesce(excluded.music, reels.music),
       source = excluded.source,
       via_hashtag = coalesce(reels.via_hashtag, excluded.via_hashtag),
       updated_at = excluded.updated_at`,
    r.id,
    r.url,
    r.owner,
    r.caption,
    r.thumbnail,
    r.videoUrl,
    r.audioUrl,
    r.postedAt,
    r.duration,
    r.views,
    r.likes,
    r.comments,
    r.music,
    r.source,
    viaHashtag ?? null,
    t,
    t,
  );
  if (r.views != null || r.likes != null) {
    run(
      "insert into reel_snapshots (reel_id, taken_at, views, likes, comments) values (?, ?, ?, ?, ?)",
      r.id,
      t,
      r.views,
      r.likes,
      r.comments,
    );
  }
}

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const BASELINE_WINDOW_MS = 90 * 86_400_000;
const MIN_BASELINE_REELS = 3;

export function scoreReels(rows: ReelRow[]): ScoredReel[] {
  const t = now();
  const owners = [...new Set(rows.map((r) => r.owner).filter(Boolean))] as string[];
  const ownerReels = new Map<string, ReelRow[]>();
  for (const owner of owners) {
    ownerReels.set(
      owner,
      all<ReelRow>(
        "select * from reels where owner = ? and (posted_at is null or posted_at >= ?)",
        owner,
        t - BASELINE_WINDOW_MS,
      ),
    );
  }
  const followers = new Map(
    all<{ username: string; followers: number | null }>("select username, followers from creators").map((c) => [
      c.username,
      c.followers,
    ]),
  );

  return rows.map((r) => {
    const metric: ScoredReel["metric"] = r.views != null ? "views" : r.likes != null ? "likes" : null;
    let baseline: number | null = null;
    if (metric && r.owner) {
      const others = (ownerReels.get(r.owner) ?? [])
        .filter((o) => o.id !== r.id)
        .map((o) => o[metric])
        .filter((v): v is number => v != null);
      if (others.length >= MIN_BASELINE_REELS) baseline = median(others);
    }
    const value = metric ? (r[metric] as number) : null;
    const ageHours = r.posted_at ? Math.max(1, (t - r.posted_at) / 3_600_000) : null;

    const snaps = all<{ views: number | null; taken_at: number }>(
      "select views, taken_at from reel_snapshots where reel_id = ? and views is not null order by taken_at desc limit 2",
      r.id,
    );
    let growthPerHour: number | null = null;
    if (snaps.length === 2) {
      const hours = (snaps[0].taken_at - snaps[1].taken_at) / 3_600_000;
      if (hours >= 0.25) growthPerHour = Math.max(0, ((snaps[0].views ?? 0) - (snaps[1].views ?? 0)) / hours);
    }
    const f = r.owner ? (followers.get(r.owner) ?? null) : null;
    return {
      ...r,
      metric,
      baseline,
      score: value != null && baseline ? value / baseline : null,
      ageHours,
      vph: r.views != null && ageHours ? r.views / ageHours : null,
      growthPerHour,
      followers: f,
      viewsPerFollower: r.views != null && f ? r.views / f : null,
    };
  });
}

export type ReelQuery = {
  days?: number;
  sort?: "outlier" | "views" | "velocity" | "recent";
  owner?: string;
  hashtag?: string;
  limit?: number;
};

export function queryReels(q: ReelQuery = {}): ScoredReel[] {
  const since = now() - (q.days ?? 30) * 86_400_000;
  const where = ["coalesce(posted_at, first_seen_at) >= ?"];
  const params: unknown[] = [since];
  if (q.owner) {
    where.push("owner = ?");
    params.push(q.owner);
  }
  if (q.hashtag) {
    where.push("via_hashtag = ?");
    params.push(q.hashtag);
  }
  const scored = scoreReels(all<ReelRow>(`select * from reels where ${where.join(" and ")}`, ...params));
  const by = q.sort ?? "outlier";
  const key = (r: ScoredReel) =>
    by === "views"
      ? (r.views ?? r.likes ?? 0)
      : by === "velocity"
        ? (r.growthPerHour ?? r.vph ?? 0)
        : by === "recent"
          ? (r.posted_at ?? r.first_seen_at)
          : (r.score ?? (r.viewsPerFollower != null ? r.viewsPerFollower : -1));
  scored.sort((a, b) => key(b) - key(a));
  return scored.slice(0, q.limit ?? 200);
}

export const getReel = (id: string) => get<ReelRow>("select * from reels where id = ?", id);

export function getScoredReel(id: string) {
  const reel = getReel(id);
  if (!reel) throw new AppError("Reel not found.", { status: 404 });
  return scoreReels([reel])[0];
}

const fmt = (n: number | null | undefined) =>
  n == null ? "n/a" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n));

/** Compact, model-friendly description of a Reel. `chars` caps caption+transcript length. */
export function reelToText(r: ScoredReel, chars = 1200) {
  const stats = [
    `views ${fmt(r.views)}`,
    `likes ${fmt(r.likes)}`,
    `comments ${fmt(r.comments)}`,
    r.score != null ? `outlier ${r.score.toFixed(1)}× vs @${r.owner}'s median ${fmt(r.baseline)} ${r.metric}` : null,
    r.vph != null ? `${fmt(r.vph)} views/hour since posting` : null,
    r.viewsPerFollower != null ? `${r.viewsPerFollower.toFixed(2)} views per follower` : null,
    r.duration ? `${Math.round(r.duration)}s long` : null,
    r.music ? `audio: ${r.music}` : null,
  ].filter(Boolean);
  const caption = (r.caption ?? "").slice(0, Math.floor(chars * 0.35));
  const transcript = (r.transcript ?? "").slice(0, Math.floor(chars * 0.65));
  return [
    `### Reel ${r.id} by @${r.owner || "unknown"}${r.posted_at ? ` · posted ${new Date(r.posted_at).toDateString()}` : ""}`,
    `Stats (source: ${r.source}, updated ${new Date(r.updated_at).toLocaleString()}): ${stats.join(" · ")}`,
    r.url ? `Link: ${r.url}` : null,
    caption ? `Caption: ${caption}` : null,
    transcript ? `Transcript: ${transcript}` : "Transcript: (not transcribed yet)",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Get (and cache) the spoken words of a Reel via Groq Whisper. */
export async function ensureTranscript(id: string) {
  const reel = getReel(id);
  if (!reel) throw new AppError("Reel not found.", { status: 404 });
  if (reel.transcript) return reel.transcript;
  const mediaUrl = reel.audio_url || reel.video_url;
  if (!mediaUrl) {
    throw new AppError("This Reel has no downloadable media from the data source.", {
      hint: "Meta's API often hides video files; Apify includes them.",
      alternatives: [ALT.upload, ALT.apify],
    });
  }
  const res = await fetch(mediaUrl, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
  if (!res?.ok) {
    throw new AppError("The Reel's media link has expired (Instagram links only last a few hours).", {
      hint: "Refresh the Trend Radar to get a fresh link, then try again, or upload the file yourself.",
      alternatives: [ALT.upload],
    });
  }
  const size = Number(res.headers.get("content-length") ?? 0);
  if (size > WHISPER_MAX_BYTES) {
    throw new AppError("This Reel's video is over the 25 MB transcription limit.", { alternatives: [ALT.upload] });
  }
  const blob = await res.blob();
  const ext = reel.audio_url ? "m4a" : "mp4";
  const text = await transcribe(blob, `${id}.${ext}`);
  run("update reels set transcript = ? where id = ?", text || "(no speech detected)", id);
  return text;
}

export async function analyzeReel(id: string) {
  const s = getSettings();
  let transcriptNote = "";
  try {
    await ensureTranscript(id);
  } catch (err) {
    transcriptNote = `\n(Transcript unavailable: ${err instanceof Error ? err.message : err} Analyze from caption and stats only, and say so.)`;
  }
  const reel = getScoredReel(id);
  const { text } = await complete({
    maxTokens: 1800,
    messages: [
      { role: "system", content: `${CORE_RULES}\n\n${brandBlock(s.brand)}` },
      {
        role: "user",
        content: `Break down why this Reel performed the way it did, then show how I can use the pattern.

${reelToText(reel, 3500)}${transcriptNote}

Answer with these sections:
## Verdict: one line on how it did vs. the creator's normal (use the outlier score if present)
## Hook (0-3s): the exact opening and why it stops the scroll
## Structure: beat-by-beat with rough timestamps
## Why it worked: topic, emotion, format, packaging (caption/on-screen text/audio)
## Steal the pattern: a fill-in-the-blank template
## 3 versions for me: adapted to my brand, each with hook + format`,
      },
    ],
  });
  run("update reels set analysis = ?, analyzed_at = ? where id = ?", text, now(), id);
  return text;
}
