import { useEffect, useState } from "react";
import { Check, Save } from "lucide-react";
import { api } from "../api.ts";
import { ErrorBox, Spinner } from "../components/ui.tsx";

type Brand = Record<
  "creatorName" | "handle" | "niche" | "audience" | "voice" | "pillars" | "offers" | "avoid" | "goals" | "examples",
  string
>;

const FIELDS: { key: keyof Brand; label: string; help: string; rows?: number }[] = [
  { key: "creatorName", label: "Your name / brand", help: "How you refer to yourself on camera." },
  { key: "handle", label: "Instagram handle", help: "@yourhandle" },
  { key: "niche", label: "Niche", help: "Be specific: “budget meal prep for college students”, not “food”.", rows: 2 },
  {
    key: "audience",
    label: "Target audience",
    help: "Who they are, what they struggle with, what they want. The more specific, the better the ideas.",
    rows: 3,
  },
  {
    key: "voice",
    label: "Voice & tone",
    help: "e.g. “blunt, funny, a bit sarcastic, short sentences, never corporate”.",
    rows: 2,
  },
  { key: "pillars", label: "Content pillars", help: "3–5 recurring themes or series you post about.", rows: 3 },
  { key: "offers", label: "Offers & CTAs", help: "What you want viewers to do: follow, comment a keyword, link in bio, product…", rows: 2 },
  { key: "goals", label: "Goals", help: "e.g. “grow to 50K by March”, “more saves and shares”, “sell my course”.", rows: 2 },
  { key: "avoid", label: "Avoid", help: "Topics, words, styles or claims you never want in your content.", rows: 2 },
  {
    key: "examples",
    label: "Examples of your content",
    help: "Paste 2–3 of your best captions or scripts so the AI copies your voice.",
    rows: 6,
  },
];

export function BrandPage() {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<{ brand: Brand }>("/settings").then((s) => setBrand(s.brand)).catch(setError);
  }, []);

  const save = async () => {
    setError(null);
    try {
      await api("/settings", { method: "PUT", body: { brand } });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e);
    }
  };

  if (!brand) return <div className="p-6">{error ? <ErrorBox error={error} /> : <Spinner />}</div>;
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-bold">Brand Memory</h1>
        <p className="text-sm text-fg-2">
          Every analysis, idea, script and chat uses this, so the output sounds like you and fits your audience.
        </p>
      </header>
      <div className="card space-y-5 p-5">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="label">{f.label}</label>
            {f.rows ? (
              <textarea
                className="input"
                rows={f.rows}
                value={brand[f.key]}
                onChange={(e) => setBrand({ ...brand, [f.key]: e.target.value })}
              />
            ) : (
              <input className="input" value={brand[f.key]} onChange={(e) => setBrand({ ...brand, [f.key]: e.target.value })} />
            )}
            <p className="mt-1 text-xs text-fg-3">{f.help}</p>
          </div>
        ))}
      </div>
      <ErrorBox error={error} />
      <div className="sticky bottom-4 flex justify-end">
        <button className="btn-primary shadow-lg" onClick={save}>
          {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />} {saved ? "Saved" : "Save Brand Memory"}
        </button>
      </div>
    </div>
  );
}
