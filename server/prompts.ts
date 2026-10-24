import type { Brand, Settings } from "./settings.ts";
import { all, get } from "./db.ts";
import { metaConfigured, apifyConfigured } from "./sources/instagram.ts";

const BRAND_LABELS: [keyof Brand, string][] = [
  ["creatorName", "Creator"],
  ["handle", "Instagram handle"],
  ["niche", "Niche"],
  ["audience", "Target audience"],
  ["voice", "Voice & tone"],
  ["pillars", "Content pillars"],
  ["offers", "Offers / CTAs"],
  ["goals", "Goals"],
  ["avoid", "Avoid"],
  ["examples", "Examples of their own content"],
];

export function brandBlock(brand: Brand) {
  const lines = BRAND_LABELS.filter(([k]) => brand[k]?.trim()).map(([k, label]) => `- ${label}: ${brand[k].trim()}`);
  if (!lines.length) {
    return "BRAND MEMORY: empty. The user hasn't filled in Brand Memory yet. Keep advice niche-agnostic, and suggest (once, briefly) filling in the Brand page so ideas fit them.";
  }
  return `BRAND MEMORY (who you're creating for; always tailor to this):\n${lines.join("\n")}`;
}

const ago = (ms: number) => {
  if (!ms) return "never";
  const h = (Date.now() - ms) / 3_600_000;
  return h < 1 ? `${Math.round(h * 60)} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
};

/** Tells the model what live data it actually has, so it can say so instead of inventing numbers. */
export function liveDataBlock(s: Settings) {
  const creators = get<{ n: number }>("select count(*) n from creators")?.n ?? 0;
  const tags = all<{ tag: string }>("select tag from hashtags").map((t) => `#${t.tag}`);
  const sources = [
    metaConfigured(s) ? "Meta Business Discovery (connected)" : "Meta Business Discovery (not connected)",
    apifyConfigured(s) ? "Apify scraper (connected)" : "Apify scraper (not connected)",
  ];
  return [
    `LIVE DATA STATUS (today is ${new Date().toDateString()}):`,
    `- Instagram sources: ${sources.join("; ")}.`,
    `- Trend Radar tracks ${creators} creator(s)${tags.length ? ` and ${tags.join(", ")}` : ""}; last refreshed ${ago(s.lastRefreshAt)}.`,
  ].join("\n");
}

export const CORE_RULES = `You are Pollen, a sharp Instagram Reels strategist and scriptwriter working for one creator.
Rules:
- Ground every claim in the CONTEXT provided (Reels, numbers, transcripts, notes, pages). Cite which source you used, e.g. "(@creator, 4.1× outlier)".
- NEVER invent view counts, dates, trends or quotes. If the data isn't in the context, say plainly that you don't have it live, then tell the user exactly how to get it in Pollen:
  • latest numbers → "Refresh the Trend Radar" (or add the creator/hashtag to the watchlist),
  • no Instagram source connected → "Settings → Instagram data: add an Apify token (free $5/mo) or connect Meta Business Discovery (free)",
  • a specific Reel → "add it to the board by link, or add it manually with its numbers",
  • general web/news info → "turn on 🌐 Web search in this chat".
- "Outlier score" = a Reel's views ÷ that creator's median views. 3×+ is a strong signal the topic/hook/format worked, not just the creator's audience size.
- Be concrete and practical: hooks as exact words to say, on-screen text, shot ideas, lengths in seconds. Use short headings and bullets. No filler.`;
