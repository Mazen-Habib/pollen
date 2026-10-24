/** A way the user can get the data the app couldn't fetch live. Rendered as a card in the UI. */
export type Alternative = {
  id: string;
  title: string;
  detail: string;
  cost?: string;
  steps?: string[];
  link?: string;
  /** Where the UI should send the user: a settings section or the manual-entry form. */
  action?: "settings:ai" | "settings:meta" | "settings:apify" | "manual-reel" | "upload" | "web-search";
};

export class AppError extends Error {
  status: number;
  hint?: string;
  alternatives?: Alternative[];
  constructor(message: string, opts: { status?: number; hint?: string; alternatives?: Alternative[] } = {}) {
    super(message);
    this.status = opts.status ?? 400;
    this.hint = opts.hint;
    this.alternatives = opts.alternatives;
  }
}

export const errorBody = (err: unknown) => {
  if (err instanceof AppError) {
    return { error: err.message, hint: err.hint, alternatives: err.alternatives };
  }
  return { error: err instanceof Error ? err.message : String(err) };
};

export const ALT = {
  groqKey: {
    id: "groq-key",
    title: "Add a free Groq API key",
    detail: "The AI features need an API key. Groq is free and doesn't need a card.",
    cost: "Free",
    steps: [
      "Go to console.groq.com and sign in with Google or email.",
      "Open API Keys → Create API Key, and copy it (starts with gsk_).",
      "Paste it in Settings → AI provider and press Save.",
    ],
    link: "https://console.groq.com/keys",
    action: "settings:ai",
  },
  meta: {
    id: "meta",
    title: "Connect Meta Business Discovery (free, official)",
    detail:
      "Instagram's official API returns views, likes and comments for any public Business/Creator account. Needs your own Instagram professional account linked to a Facebook Page.",
    cost: "Free · ~200 calls/hour",
    steps: [
      "Switch your Instagram to a Professional (Creator or Business) account and link a Facebook Page to it.",
      "Create a free app at developers.facebook.com and get a token in Graph API Explorer.",
      "Paste it in Settings → Instagram data → Meta. Pollen turns it into a 60-day token and finds your account ID.",
    ],
    link: "https://developers.facebook.com/apps",
    action: "settings:meta",
  },
  apify: {
    id: "apify",
    title: "Add an Apify token (easiest, works for every public account)",
    detail:
      "Apify's Instagram scrapers fetch any public creator's or hashtag's Reels with view counts. The free plan includes $5 of credit every month.",
    cost: "Free $5/mo ≈ 1,900 reels · then ~$2.30 per 1,000",
    steps: [
      "Sign up free at apify.com (no card needed).",
      "Open Settings → API & Integrations and copy your Personal API token.",
      "Paste it in Pollen → Settings → Instagram data → Apify.",
    ],
    link: "https://console.apify.com/settings/integrations",
    action: "settings:apify",
  },
  manual: {
    id: "manual",
    title: "Add the Reel manually",
    detail:
      "Paste the caption and the numbers you see on Instagram (views, likes, comments). You can upload the video file and Pollen will transcribe it for free with Groq Whisper.",
    cost: "Free · no setup",
    action: "manual-reel",
  },
  upload: {
    id: "upload",
    title: "Upload the video or audio file",
    detail:
      "Save the Reel (Instagram's own download/remix, or screen-record it) and upload it here. Groq Whisper transcribes it for free.",
    cost: "Free",
    action: "upload",
  },
  webSearch: {
    id: "web-search",
    title: "Use web search in chat",
    detail: "Turn on 🌐 Web search in an AI chat. The model searches and reads current pages through Groq.",
    cost: "Free (Groq)",
    action: "web-search",
  },
} satisfies Record<string, Alternative>;
