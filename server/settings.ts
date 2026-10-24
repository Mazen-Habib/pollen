import { all, run } from "./db.ts";

export type Brand = {
  creatorName: string;
  handle: string;
  niche: string;
  audience: string;
  voice: string;
  pillars: string;
  offers: string;
  avoid: string;
  goals: string;
  examples: string;
};

export const emptyBrand: Brand = {
  creatorName: "",
  handle: "",
  niche: "",
  audience: "",
  voice: "",
  pillars: "",
  offers: "",
  avoid: "",
  goals: "",
  examples: "",
};

export const defaults = {
  // AI provider (any OpenAI-compatible endpoint; Groq by default)
  llmBaseUrl: "https://api.groq.com/openai/v1",
  llmApiKey: "",
  chatModel: "openai/gpt-oss-120b",
  fallbackModel: "llama-3.3-70b-versatile",
  fastModel: "llama-3.1-8b-instant",
  searchModel: "openai/gpt-oss-120b",
  whisperModel: "whisper-large-v3-turbo",
  contextBudget: 4500, // tokens of source material per AI request; Groq free tier is ~8K tokens/minute

  // Instagram live data
  sourcePriority: "auto" as "auto" | "meta" | "apify",
  metaAccessToken: "",
  metaTokenExpiresAt: 0,
  metaIgUserId: "",
  metaIgUsername: "",
  metaGraphVersion: "v24.0",
  apifyToken: "",
  reelsPerCreator: 12,
  reelsPerHashtag: 15,
  lookbackDays: 30,

  // Automation
  autoRefreshHours: 24, // 0 = off
  autoReport: true,
  autoTranscribeTop: 5,
  lastRefreshAt: 0,

  brand: emptyBrand,
};

export type Settings = typeof defaults;
export type SettingKey = keyof Settings;

export const SECRET_KEYS: SettingKey[] = ["llmApiKey", "metaAccessToken", "apifyToken"];

export function getSettings(): Settings {
  const rows = all<{ key: string; value: string }>("select key, value from settings");
  const out: Record<string, unknown> = { ...defaults, brand: { ...emptyBrand } };
  for (const { key, value } of rows) {
    if (!(key in defaults)) continue;
    try {
      out[key] = JSON.parse(value);
    } catch {
      out[key] = value;
    }
  }
  out.brand = { ...emptyBrand, ...(out.brand as Partial<Brand>) };
  return out as Settings;
}

export function setSettings(patch: Partial<Settings>) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in defaults) || value === undefined) continue;
    run(
      "insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value",
      key,
      JSON.stringify(value),
    );
  }
}

const mask = (secret: string) => (secret ? `${secret.slice(0, 4)}…${secret.slice(-4)}` : "");

/** Settings safe to send to the browser: secrets are masked. */
export function publicSettings() {
  const s = getSettings();
  const out: Record<string, unknown> = { ...s };
  for (const key of SECRET_KEYS) {
    out[key] = mask(s[key] as string);
    out[`has_${key}`] = Boolean(s[key]);
  }
  return out;
}

export const isGroq = (s: Settings = getSettings()) => s.llmBaseUrl.includes("groq.com");
