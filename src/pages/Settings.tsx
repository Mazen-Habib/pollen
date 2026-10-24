import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, ExternalLink, Save } from "lucide-react";
import { api, type Creator, type Hashtag } from "../api.ts";
import { useStatus } from "../status.ts";
import { ErrorBox, Spinner } from "../components/ui.tsx";

type S = Record<string, any>;

const PROVIDERS = [
  { label: "Groq (free, recommended)", url: "https://api.groq.com/openai/v1" },
  { label: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  { label: "Google Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai" },
  { label: "OpenAI", url: "https://api.openai.com/v1" },
];

function Section({ id, title, desc, children }: { id: string; title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-6 space-y-4 p-5">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {desc && <div className="mt-1 text-sm text-zinc-400">{desc}</div>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, help, children }: { label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {help && <p className="mt-1 text-xs text-zinc-500">{help}</p>}
    </div>
  );
}

function TestResult({ result }: { result: { ok?: boolean; message?: string; error?: unknown } | null }) {
  if (!result) return null;
  if (result.error) return <ErrorBox error={result.error} />;
  return (
    <div className="flex items-center gap-2 text-sm text-emerald-300">
      <CheckCircle2 className="h-4 w-4" /> {result.message}
    </div>
  );
}

export function SettingsPage({ section }: { section?: string }) {
  const { refreshStatus } = useStatus();
  const [s, setS] = useState<S | null>(null);
  const [draft, setDraft] = useState<S>({});
  const [savedKey, setSavedKey] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [tests, setTests] = useState<Record<string, { ok?: boolean; message?: string; error?: unknown } | null>>({});
  const [testing, setTesting] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [meta, setMeta] = useState({ token: "", appId: "", appSecret: "" });
  const [metaBusy, setMetaBusy] = useState(false);
  const [counts, setCounts] = useState({ creators: 0, hashtags: 0 });

  useEffect(() => {
    api<S>("/settings").then(setS).catch(setError);
    Promise.all([api<Creator[]>("/creators"), api<Hashtag[]>("/hashtags")])
      .then(([c, h]) => setCounts({ creators: c.length, hashtags: h.length }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (s && section) document.getElementById(section)?.scrollIntoView({ behavior: "smooth" });
  }, [s, section]);

  const val = (k: string) => (k in draft ? draft[k] : s?.[k]);
  const set = (k: string) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value });

  const save = async (keys: string[], tag: string) => {
    setError(null);
    const body: S = {};
    for (const k of keys) if (k in draft) body[k] = draft[k];
    try {
      const next = await api<S>("/settings", { method: "PUT", body });
      setS(next);
      setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !keys.includes(k))));
      setSavedKey(tag);
      setTimeout(() => setSavedKey(""), 2000);
      refreshStatus();
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  };

  const test = async (which: string) => {
    setTesting(which);
    setTests((t) => ({ ...t, [which]: null }));
    try {
      const res = await api<{ ok: boolean; message: string; models?: string[] }>(`/sources/test/${which}`, { method: "POST" });
      if (res.models) setModels(res.models);
      setTests((t) => ({ ...t, [which]: res }));
    } catch (e) {
      setTests((t) => ({ ...t, [which]: { error: e } }));
    } finally {
      setTesting("");
    }
  };

  const connectMeta = async () => {
    setMetaBusy(true);
    setTests((t) => ({ ...t, meta: null }));
    try {
      const res = await api<{ chosen: { igUsername: string }; accounts: unknown[]; expiresAt: number; settings: S }>(
        "/sources/meta/connect",
        { body: meta },
      );
      setS(res.settings);
      setMeta({ token: "", appId: "", appSecret: "" });
      setTests((t) => ({
        ...t,
        meta: {
          ok: true,
          message: `Connected @${res.chosen.igUsername}. Token valid until ${new Date(res.expiresAt).toLocaleDateString()}.`,
        },
      }));
      refreshStatus();
    } catch (e) {
      setTests((t) => ({ ...t, meta: { error: e } }));
    } finally {
      setMetaBusy(false);
    }
  };

  if (!s) return <div className="p-6">{error ? <ErrorBox error={error} /> : <Spinner />}</div>;

  const SaveBtn = ({ keys, tag }: { keys: string[]; tag: string }) => (
    <button className="btn-primary" onClick={() => save(keys, tag)}>
      {savedKey === tag ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />} {savedKey === tag ? "Saved" : "Save"}
    </button>
  );

  const refreshesPerMonth = Number(val("autoRefreshHours")) ? (30 * 24) / Number(val("autoRefreshHours")) : 30;
  const apifyMonthly =
    (counts.creators * Number(val("reelsPerCreator")) + counts.hashtags * Number(val("reelsPerHashtag"))) *
    refreshesPerMonth *
    0.0026;
  const metaDaysLeft = s.metaTokenExpiresAt ? Math.round((s.metaTokenExpiresAt - Date.now()) / 86_400_000) : null;
  const isGroq = String(val("llmBaseUrl")).includes("groq.com");

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-zinc-400">
          Keys are stored only on this PC (in <code>data/pollen.db</code>) and are only sent to the service they belong to.
        </p>
      </header>
      <ErrorBox error={error} onDismiss={() => setError(null)} />

      <Section
        id="ai"
        title="AI provider"
        desc={
          <>
            Any OpenAI-compatible API works. Groq is free and fast, and it powers live web search (gpt-oss) and free
            transcription (Whisper). Get a key at{" "}
            <a className="text-amber-300 underline" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">
              console.groq.com/keys
            </a>
            .
          </>
        }
      >
        <Field label="Provider">
          <select className="input" value={val("llmBaseUrl")} onChange={set("llmBaseUrl")}>
            {PROVIDERS.map((p) => (
              <option key={p.url} value={p.url}>
                {p.label}
              </option>
            ))}
            {!PROVIDERS.some((p) => p.url === val("llmBaseUrl")) && <option value={val("llmBaseUrl")}>Custom</option>}
          </select>
        </Field>
        <Field label="Base URL" help="Change this for any other OpenAI-compatible endpoint (e.g. a local Ollama: http://localhost:11434/v1).">
          <input className="input" value={val("llmBaseUrl")} onChange={set("llmBaseUrl")} />
        </Field>
        <Field label="API key" help={s.has_llmApiKey ? `Saved: ${s.llmApiKey}. Paste a new one to replace it.` : "Not set yet."}>
          <input
            className="input"
            type="password"
            placeholder={s.has_llmApiKey ? "••••••••" : "gsk_…"}
            value={draft.llmApiKey ?? ""}
            onChange={set("llmApiKey")}
          />
        </Field>
        <datalist id="models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Main model" help="Analysis, reports, scripts, chat.">
            <input className="input" list="models" value={val("chatModel")} onChange={set("chatModel")} />
          </Field>
          <Field label="Fallback model" help="Used automatically when the main one hits its rate limit.">
            <input className="input" list="models" value={val("fallbackModel")} onChange={set("fallbackModel")} />
          </Field>
          <Field label="Web search model" help={isGroq ? "Must support Groq browser_search (gpt-oss)." : "Web search only works on Groq."}>
            <input className="input" list="models" value={val("searchModel")} onChange={set("searchModel")} />
          </Field>
          <Field label="Transcription model" help="Groq: whisper-large-v3-turbo · OpenAI: whisper-1">
            <input className="input" list="models" value={val("whisperModel")} onChange={set("whisperModel")} />
          </Field>
          <Field
            label="Context budget (tokens)"
            help="How much source material goes into each request. Groq's free tier allows ~8K tokens/min on gpt-oss-120b, so keep this ≤ 5000 there."
          >
            <input className="input" type="number" value={val("contextBudget")} onChange={set("contextBudget")} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SaveBtn
            tag="ai"
            keys={["llmBaseUrl", "llmApiKey", "chatModel", "fallbackModel", "searchModel", "whisperModel", "contextBudget"]}
          />
          <button className="btn-ghost" disabled={testing === "llm"} onClick={() => test("llm")}>
            {testing === "llm" && <Spinner />} Test connection
          </button>
        </div>
        <TestResult result={tests.llm ?? null} />
      </Section>

      <Section
        id="instagram"
        title="Instagram live data"
        desc="Instagram has no free public API for other creators' Reels. Pollen tries your sources in order and tells you when something can't be fetched."
      >
        <Field label="Source order">
          <select className="input" value={val("sourcePriority")} onChange={set("sourcePriority")}>
            <option value="auto">Meta first (free), Apify for anything Meta can't see</option>
            <option value="apify">Apify first, Meta as backup</option>
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Reels per creator">
            <input className="input" type="number" value={val("reelsPerCreator")} onChange={set("reelsPerCreator")} />
          </Field>
          <Field label="Reels per hashtag">
            <input className="input" type="number" value={val("reelsPerHashtag")} onChange={set("reelsPerHashtag")} />
          </Field>
          <Field label="Look back (days)">
            <input className="input" type="number" value={val("lookbackDays")} onChange={set("lookbackDays")} />
          </Field>
        </div>
        <SaveBtn tag="ig" keys={["sourcePriority", "reelsPerCreator", "reelsPerHashtag", "lookbackDays"]} />
      </Section>

      <Section
        id="apify"
        title="Apify (easiest)"
        desc={
          <>
            Works for every public account and hashtag, includes view counts and video files (so Reels can be transcribed).
            Free plan: $5 credit/month, about 1,900 Reels.{" "}
            <a className="text-amber-300 underline" href="https://console.apify.com/sign-up" target="_blank" rel="noreferrer">
              Sign up
            </a>
            , then copy your token from{" "}
            <a
              className="text-amber-300 underline"
              href="https://console.apify.com/settings/integrations"
              target="_blank"
              rel="noreferrer"
            >
              Settings → API &amp; Integrations
            </a>
            .
          </>
        }
      >
        <Field
          label="Apify API token"
          help={s.has_apifyToken ? `Saved: ${s.apifyToken}` : "Starts with apify_api_…"}
        >
          <input
            className="input"
            type="password"
            placeholder={s.has_apifyToken ? "••••••••" : "apify_api_…"}
            value={draft.apifyToken ?? ""}
            onChange={set("apifyToken")}
          />
        </Field>
        <div className="rounded-lg bg-zinc-950/60 p-3 text-sm text-zinc-400">
          Estimated cost with your watchlist ({counts.creators} creators, {counts.hashtags} hashtags,{" "}
          {Math.round(refreshesPerMonth)} refreshes/month):{" "}
          <span className={apifyMonthly > 5 ? "font-semibold text-amber-300" : "font-semibold text-emerald-300"}>
            ≈ ${apifyMonthly.toFixed(2)}/month
          </span>
          {apifyMonthly > 5
            ? ". That's over the free $5. Lower Reels per creator, refresh less often, or let Meta handle Business/Creator accounts."
            : ". Within the free $5."}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SaveBtn tag="apify" keys={["apifyToken"]} />
          <button className="btn-ghost" disabled={testing === "apify"} onClick={() => test("apify")}>
            {testing === "apify" && <Spinner />} Test & show usage
          </button>
          {s.has_apifyToken && (
            <button
              className="btn-danger"
              onClick={async () => {
                setS(await api<S>("/settings", { method: "PUT", body: { apifyToken: null } }));
                refreshStatus();
              }}
            >
              Remove
            </button>
          )}
        </div>
        <TestResult result={tests.apify ?? null} />
      </Section>

      <Section
        id="meta"
        title="Meta Business Discovery (free, official)"
        desc="Instagram's own API. Returns views, likes and comments of any public Business or Creator account (most creators are). About 15 minutes of one-time setup."
      >
        {s.metaIgUserId ? (
          <div className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-200">
            Connected as @{s.metaIgUsername || s.metaIgUserId}.
            {metaDaysLeft != null &&
              (metaDaysLeft < 0 ? (
                <span className="text-rose-300"> Token expired: reconnect below.</span>
              ) : (
                <span className={metaDaysLeft < 7 ? "text-amber-300" : ""}> Token expires in {metaDaysLeft} days.</span>
              ))}
          </div>
        ) : null}
        <ol className="list-decimal space-y-2 pl-5 text-sm text-zinc-300">
          <li>
            In the Instagram app: <b>Settings → Account type and tools → Switch to professional account</b> (Creator is fine).
          </li>
          <li>
            Link a Facebook Page to it: Instagram <b>Edit profile → Page</b> (create a Page if you don't have one).
          </li>
          <li>
            Go to{" "}
            <a className="text-amber-300 underline" href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer">
              developers.facebook.com/apps
            </a>{" "}
            → <b>Create app</b> → use case <b>Other</b> → type <b>Business</b>. Name it “Pollen”.
          </li>
          <li>
            Open{" "}
            <a
              className="text-amber-300 underline"
              href="https://developers.facebook.com/tools/explorer"
              target="_blank"
              rel="noreferrer"
            >
              Graph API Explorer
            </a>
            , pick your app, choose <b>User Token</b>, add permissions <code>instagram_basic</code>, <code>pages_show_list</code>,{" "}
            <code>pages_read_engagement</code>, <code>business_management</code>, then <b>Generate Access Token</b> and allow your
            Page + Instagram account.
          </li>
          <li>
            Copy the token. For a 60-day token (instead of 1 hour), also copy <b>App ID</b> and <b>App Secret</b> from your app's{" "}
            <b>App settings → Basic</b>.
          </li>
        </ol>
        <Field label="Access token">
          <input
            className="input"
            type="password"
            placeholder="EAAG…"
            value={meta.token}
            onChange={(e) => setMeta({ ...meta, token: e.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="App ID (recommended)">
            <input className="input" value={meta.appId} onChange={(e) => setMeta({ ...meta, appId: e.target.value })} />
          </Field>
          <Field label="App secret (recommended)" help="Only used once to get the 60-day token; not stored.">
            <input
              className="input"
              type="password"
              value={meta.appSecret}
              onChange={(e) => setMeta({ ...meta, appSecret: e.target.value })}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary" disabled={!meta.token || metaBusy} onClick={connectMeta}>
            {metaBusy && <Spinner />} Connect
          </button>
          {s.metaIgUserId && (
            <>
              <button className="btn-ghost" disabled={testing === "meta"} onClick={() => test("meta")}>
                {testing === "meta" && <Spinner />} Test
              </button>
              <button
                className="btn-danger"
                onClick={async () => {
                  setS(await api<S>("/sources/meta/disconnect", { method: "POST" }));
                  refreshStatus();
                }}
              >
                Disconnect
              </button>
            </>
          )}
          <a
            className="btn-ghost ml-auto"
            href="https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery"
            target="_blank"
            rel="noreferrer"
          >
            Meta docs <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <TestResult result={tests.meta ?? null} />
        <p className="text-xs text-zinc-500">
          Limits: Meta only sees Business/Creator accounts (not personal ones), doesn't provide video files (upload them for
          transcripts), and shows likes/comments but no views for hashtag searches. Pollen falls back to Apify for anything
          Meta can't fetch.
        </p>
      </Section>

      <Section id="automation" title="Automation" desc="Runs while Pollen is open (the server window must be running).">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Auto-refresh radar">
            <select className="input" value={val("autoRefreshHours")} onChange={set("autoRefreshHours")}>
              <option value={0}>Off</option>
              <option value={6}>Every 6 hours</option>
              <option value={12}>Every 12 hours</option>
              <option value={24}>Daily</option>
              <option value={48}>Every 2 days</option>
              <option value={168}>Weekly</option>
            </select>
          </Field>
          <Field label="Ideas report after refresh">
            <select
              className="input"
              value={String(val("autoReport"))}
              onChange={(e) => setDraft({ ...draft, autoReport: e.target.value === "true" })}
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </Field>
          <Field label="Transcribe top N for reports" help="Free via Groq Whisper.">
            <input className="input" type="number" value={val("autoTranscribeTop")} onChange={set("autoTranscribeTop")} />
          </Field>
        </div>
        <SaveBtn tag="auto" keys={["autoRefreshHours", "autoReport", "autoTranscribeTop"]} />
      </Section>
    </div>
  );
}
