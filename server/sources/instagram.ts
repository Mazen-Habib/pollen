import type { Settings } from "../settings.ts";
import { AppError, ALT, type Alternative } from "../errors.ts";

export type NormalizedReel = {
  id: string;
  url: string;
  owner: string;
  caption: string;
  thumbnail: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  postedAt: number | null;
  duration: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  music: string | null;
  source: "meta" | "apify" | "manual";
};

export type ProfileInfo = {
  username: string;
  fullName: string | null;
  followers: number | null;
  mediaCount: number | null;
  profilePic: string | null;
};

export type SourceName = "meta" | "apify";

export const cleanUsername = (raw: string) =>
  raw
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .split(/[/?#\s]/)[0]
    .toLowerCase();

export const cleanHashtag = (raw: string) => raw.trim().replace(/^#/, "").replace(/\s+/g, "").toLowerCase();

export const shortcodeFromUrl = (url: string) =>
  url.match(/instagram\.com\/(?:[^/]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/i)?.[1] ?? null;

export const isInstagramUrl = (url: string) => /^https?:\/\/(www\.)?instagram\.com\//i.test(url);

export const metaConfigured = (s: Settings) => Boolean(s.metaAccessToken && s.metaIgUserId);
export const apifyConfigured = (s: Settings) => Boolean(s.apifyToken);

/** Live sources to try, in order, for this user's settings. */
export function sourceOrder(s: Settings): SourceName[] {
  const order: SourceName[] = s.sourcePriority === "apify" ? ["apify", "meta"] : ["meta", "apify"];
  return order.filter((name) => (name === "meta" ? metaConfigured(s) : apifyConfigured(s)));
}

/** Ways to get live Instagram data the user hasn't set up yet, plus the always-available manual route. */
export function instagramAlternatives(s: Settings, opts: { includeManual?: boolean } = {}): Alternative[] {
  const alts: Alternative[] = [];
  if (!apifyConfigured(s)) alts.push(ALT.apify);
  if (!metaConfigured(s)) alts.push(ALT.meta);
  if (opts.includeManual !== false) alts.push(ALT.manual);
  return alts;
}

const num = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
};

/* ------------------------------------------------------------------ Meta */

class MetaError extends Error {
  code: number;
  subcode: number;
  constructor(err: { message?: string; code?: number; error_subcode?: number }) {
    super(err.message ?? "Meta API error");
    this.code = err.code ?? 0;
    this.subcode = err.error_subcode ?? 0;
  }
}

async function graphGet(s: Settings, path: string, params: Record<string, string>, token = s.metaAccessToken) {
  const url = new URL(`https://graph.facebook.com/${s.metaGraphVersion}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok || data.error) throw new MetaError(data.error ?? { message: `HTTP ${res.status}` });
  return data;
}

function metaMessage(err: unknown, username?: string): string {
  if (!(err instanceof MetaError)) return err instanceof Error ? err.message : String(err);
  if (err.code === 190) return "Meta token expired or invalid. Reconnect it in Settings → Instagram data → Meta.";
  if (err.subcode === 2207013 || err.code === 110 || /cannot find user|invalid user/i.test(err.message)) {
    return `${username ? `@${username}` : "This account"} isn't a public Business/Creator account, so Meta can't see it.`;
  }
  if ([4, 17, 32, 613].includes(err.code)) return "Meta rate limit reached (about 200 calls/hour). Try again later.";
  if (err.code === 10 || err.code === 200) {
    return `Meta permission missing (${err.message}). Regenerate the token with instagram_basic, pages_show_list, pages_read_engagement and business_management.`;
  }
  return err.message;
}

const MEDIA_FIELD_SETS = [
  "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,view_count,media_url,thumbnail_url",
  "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,view_count",
  "id,caption,media_type,permalink,timestamp,like_count,comments_count",
];

function normalizeMeta(m: Record<string, any>, owner: string): NormalizedReel {
  const isVideo = m.media_type === "VIDEO";
  return {
    id: shortcodeFromUrl(m.permalink ?? "") ?? String(m.id),
    url: m.permalink ?? "",
    owner,
    caption: m.caption ?? "",
    thumbnail: m.thumbnail_url ?? (!isVideo ? (m.media_url ?? null) : null),
    videoUrl: isVideo ? (m.media_url ?? null) : null,
    audioUrl: null,
    postedAt: m.timestamp ? Date.parse(m.timestamp) : null,
    duration: null,
    views: num(m.view_count),
    likes: num(m.like_count),
    comments: num(m.comments_count),
    music: null,
    source: "meta",
  };
}

const isReel = (m: Record<string, any>) =>
  m.media_product_type ? m.media_product_type === "REELS" : m.media_type === "VIDEO";

export async function metaFetchCreator(s: Settings, username: string, limit: number) {
  let lastErr: unknown;
  for (const fields of MEDIA_FIELD_SETS) {
    try {
      const data = await graphGet(s, s.metaIgUserId, {
        fields:
          `business_discovery.username(${username})` +
          `{username,name,profile_picture_url,followers_count,media_count,media.limit(${Math.min(50, limit * 3)}){${fields}}}`,
      });
      const bd = data.business_discovery ?? {};
      const profile: ProfileInfo = {
        username,
        fullName: bd.name ?? null,
        followers: num(bd.followers_count),
        mediaCount: num(bd.media_count),
        profilePic: bd.profile_picture_url ?? null,
      };
      const media = (bd.media?.data ?? []) as Record<string, any>[];
      const reels = media.filter(isReel).slice(0, limit).map((m) => normalizeMeta(m, username));
      return { profile, reels };
    } catch (err) {
      lastErr = err;
      // Older API versions or restricted accounts reject some fields; retry with fewer.
      if (err instanceof MetaError && err.code === 100 && err.subcode !== 2207013) continue;
      break;
    }
  }
  throw new Error(metaMessage(lastErr, username));
}

export async function metaFetchHashtag(s: Settings, tag: string, limit: number) {
  try {
    const search = await graphGet(s, "ig_hashtag_search", { user_id: s.metaIgUserId, q: tag });
    const hashtagId = search.data?.[0]?.id;
    if (!hashtagId) throw new Error(`Meta found no hashtag #${tag}.`);
    let media: Record<string, any>[] = [];
    for (const fields of [
      "id,caption,media_type,permalink,timestamp,like_count,comments_count,media_url",
      "id,caption,media_type,permalink,timestamp,like_count,comments_count",
    ]) {
      try {
        const data = await graphGet(s, `${hashtagId}/top_media`, { user_id: s.metaIgUserId, fields, limit: "50" });
        media = data.data ?? [];
        break;
      } catch (err) {
        if (err instanceof MetaError && err.code === 100) continue;
        throw err;
      }
    }
    // Hashtag media doesn't expose the owner's username or views — only likes/comments.
    return media.filter((m) => m.media_type === "VIDEO").slice(0, limit).map((m) => normalizeMeta(m, ""));
  } catch (err) {
    throw new Error(metaMessage(err));
  }
}

export async function metaTest(s: Settings) {
  try {
    const me = await graphGet(s, s.metaIgUserId, { fields: "username,followers_count" });
    const debug = await graphGet(s, "debug_token", { input_token: s.metaAccessToken }).catch(() => null);
    return {
      username: me.username as string,
      followers: num(me.followers_count),
      expiresAt: debug?.data?.expires_at ? Number(debug.data.expires_at) * 1000 : null,
    };
  } catch (err) {
    throw new AppError(metaMessage(err));
  }
}

/** Swap a short-lived Graph API Explorer token for a ~60-day one. */
export async function metaExchangeToken(s: Settings, appId: string, appSecret: string, shortToken: string) {
  try {
    const data = await graphGet(
      s,
      "oauth/access_token",
      { grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken },
      shortToken,
    );
    return {
      token: data.access_token as string,
      expiresAt: data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : Date.now() + 60 * 86_400_000,
    };
  } catch (err) {
    throw new AppError(`Couldn't exchange the token: ${metaMessage(err)}`);
  }
}

/** List Instagram professional accounts reachable with a token (via the Facebook Pages they're linked to). */
export async function metaDiscoverAccounts(s: Settings, token: string) {
  try {
    const data = await graphGet(s, "me/accounts", { fields: "name,instagram_business_account{id,username}" }, token);
    return ((data.data ?? []) as Record<string, any>[])
      .filter((p) => p.instagram_business_account)
      .map((p) => ({
        pageName: p.name as string,
        igUserId: p.instagram_business_account.id as string,
        igUsername: (p.instagram_business_account.username ?? "") as string,
      }));
  } catch (err) {
    throw new AppError(`Couldn't list your accounts: ${metaMessage(err)}`);
  }
}

/* ----------------------------------------------------------------- Apify */

const APIFY = "https://api.apify.com/v2";
const REEL_ACTOR = "apify~instagram-reel-scraper";
const HASHTAG_ACTOR = "apify~instagram-hashtag-scraper";

async function apifyFetch(s: Settings, path: string, init: RequestInit = {}) {
  const res = await fetch(`${APIFY}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${s.apifyToken}`, "Content-Type": "application/json", ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(90_000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) {
    const message = data?.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new Error("Apify rejected the token. Copy it again from Apify → Settings → API & Integrations.");
    if (res.status === 402 || /credit|usage|limit/i.test(message)) {
      throw new Error(`${message}. The free $5 resets monthly, or connect Meta Business Discovery (free).`);
    }
    throw new Error(message);
  }
  return data;
}

// Apify refuses runs whose maximum possible cost is below its per-run minimum (~$0.0073 ≈ 3 results),
// so never cap below this. Actual cost is still only what the actor returns.
const MIN_MAX_ITEMS = 10;

/** Start an actor run, wait for it, and return its dataset items. maxItems caps what you can be charged for. */
async function apifyRun(s: Settings, actor: string, input: unknown, maxItems: number, onLog?: (m: string) => void) {
  const cap = Math.max(maxItems, MIN_MAX_ITEMS);
  const started = await apifyFetch(s, `/acts/${actor}/runs?maxItems=${cap}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  let runInfo = started.data as Record<string, any>;
  onLog?.(`Apify run started (${actor.split("~")[1]})…`);
  const deadline = Date.now() + 10 * 60_000;
  while (!["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(runInfo.status)) {
    if (Date.now() > deadline) throw new Error("Apify run took longer than 10 minutes; check it in the Apify console.");
    const polled = await apifyFetch(s, `/actor-runs/${runInfo.id}?waitForFinish=60`);
    runInfo = polled.data;
  }
  const res = await fetch(`${APIFY}/datasets/${runInfo.defaultDatasetId}/items?clean=true&format=json`, {
    headers: { Authorization: `Bearer ${s.apifyToken}` },
  });
  const items = (await res.json().catch(() => [])) as Record<string, any>[];
  if (runInfo.status !== "SUCCEEDED" && !items.length) throw new Error(`Apify run ${runInfo.status.toLowerCase()}.`);
  return items;
}

function normalizeApify(item: Record<string, any>): NormalizedReel {
  const music = item.musicInfo
    ? [item.musicInfo.song_name, item.musicInfo.artist_name].filter(Boolean).join(" — ") || null
    : null;
  return {
    id: item.shortCode ?? shortcodeFromUrl(item.url ?? "") ?? String(item.id),
    url: item.url ?? (item.shortCode ? `https://www.instagram.com/reel/${item.shortCode}/` : ""),
    owner: String(item.ownerUsername ?? "").toLowerCase(),
    caption: item.caption ?? "",
    thumbnail: item.displayUrl ?? null,
    videoUrl: item.videoUrl ?? null,
    audioUrl: item.audioUrl ?? null,
    postedAt: item.timestamp ? Date.parse(item.timestamp) : null,
    duration: num(item.videoDuration),
    views: num(item.videoPlayCount) ?? num(item.videoViewCount),
    likes: num(item.likesCount),
    comments: num(item.commentsCount),
    music,
    source: "apify",
  };
}

const isApifyError = (item: Record<string, any>) => Boolean(item.error || item.errorDescription);

/** One Apify run for many creators (cheaper than one run each). */
export async function apifyFetchCreators(s: Settings, usernames: string[], limit: number, onLog?: (m: string) => void) {
  const items = await apifyRun(
    s,
    REEL_ACTOR,
    { username: usernames, resultsLimit: limit, onlyPostsNewerThan: `${s.lookbackDays} days`, skipPinnedPosts: true },
    usernames.length * limit + 5,
    onLog,
  );
  const byOwner = new Map<string, NormalizedReel[]>(usernames.map((u) => [u, []]));
  const errors = new Map<string, string>();
  for (const item of items) {
    if (isApifyError(item)) {
      const who = cleanUsername(String(item.inputUrl ?? item.username ?? item.url ?? ""));
      if (who) errors.set(who, String(item.errorDescription ?? item.error));
      continue;
    }
    const reel = normalizeApify(item);
    if (!byOwner.has(reel.owner)) byOwner.set(reel.owner, []);
    byOwner.get(reel.owner)!.push(reel);
  }
  return { byOwner, errors };
}

export async function apifyFetchHashtag(s: Settings, tag: string, limit: number, onLog?: (m: string) => void) {
  const items = await apifyRun(s, HASHTAG_ACTOR, { hashtags: [tag], resultsType: "reels", resultsLimit: limit }, limit + 2, onLog);
  return items.filter((i) => !isApifyError(i)).map(normalizeApify);
}

export async function apifyFetchReel(s: Settings, url: string) {
  const items = await apifyRun(s, REEL_ACTOR, { username: [url], resultsLimit: 1 }, 2);
  const item = items.find((i) => !isApifyError(i));
  if (!item) throw new Error(String(items[0]?.errorDescription ?? "Apify couldn't load that Reel (private or removed?)."));
  return normalizeApify(item);
}

export async function apifyTest(s: Settings) {
  try {
    const me = await apifyFetch(s, "/users/me");
    const limits = await apifyFetch(s, "/users/me/limits").catch(() => null);
    return {
      username: me.data?.username as string,
      plan: (me.data?.plan?.id ?? "") as string,
      usedUsd: limits?.data?.current?.monthlyUsageUsd ?? null,
      limitUsd: limits?.data?.limits?.maxMonthlyUsageUsd ?? null,
    };
  } catch (err) {
    throw new AppError(err instanceof Error ? err.message : String(err));
  }
}

/** Fetch one Reel by URL through whatever live source is available. */
export async function fetchReelByUrl(s: Settings, url: string, ownerHint?: string): Promise<NormalizedReel> {
  const shortcode = shortcodeFromUrl(url);
  if (!shortcode) throw new AppError("That doesn't look like an Instagram Reel/post link.");
  const failures: string[] = [];
  for (const source of sourceOrder(s)) {
    try {
      if (source === "apify") return await apifyFetchReel(s, url);
      if (!ownerHint) {
        failures.push("Meta: needs the creator's @username to find a Reel (Meta can't look up links directly).");
        continue;
      }
      const { reels } = await metaFetchCreator(s, cleanUsername(ownerHint), 50);
      const match = reels.find((r) => r.id === shortcode);
      if (match) return match;
      failures.push(`Meta: Reel not among @${cleanUsername(ownerHint)}'s latest 50 posts.`);
    } catch (err) {
      failures.push(`${source === "meta" ? "Meta" : "Apify"}: ${err instanceof Error ? err.message : err}`);
    }
  }
  throw new AppError(
    failures.length ? "Couldn't fetch this Reel live." : "No live Instagram source is connected yet.",
    { hint: failures.join(" "), alternatives: instagramAlternatives(s) },
  );
}
