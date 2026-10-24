import { useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, ExternalLink, Loader2, X, Zap } from "lucide-react";
import { ApiError, navigate, type Alternative } from "../api.ts";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-pollen">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh]" onMouseDown={onClose}>
      <div
        className={`card w-full ${wide ? "max-w-3xl" : "max-w-lg"} bg-zinc-900 p-5 shadow-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn-ghost"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : label}
    </button>
  );
}

/** Cards that explain how to get live data the app couldn't fetch. */
export function Alternatives({
  alternatives,
  onManual,
  onUpload,
  compact,
}: {
  alternatives: Alternative[];
  onManual?: () => void;
  onUpload?: () => void;
  compact?: boolean;
}) {
  if (!alternatives.length) return null;
  const act = (alt: Alternative) => {
    if (alt.action?.startsWith("settings:")) navigate(`#/settings/${alt.action.split(":")[1]}`);
    else if (alt.action === "manual-reel") onManual?.();
    else if (alt.action === "upload") onUpload?.();
  };
  const actionLabel = (alt: Alternative) =>
    alt.action?.startsWith("settings:")
      ? "Set up"
      : alt.action === "manual-reel"
        ? onManual && "Add manually"
        : alt.action === "upload"
          ? onUpload && "Upload file"
          : null;
  return (
    <div className={`grid gap-3 ${compact ? "" : "md:grid-cols-2 xl:grid-cols-3"}`}>
      {alternatives.map((alt) => (
        <div key={alt.id} className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 font-medium text-amber-100">
              <Zap className="h-4 w-4 shrink-0 text-amber-400" /> {alt.title}
            </div>
          </div>
          {alt.cost && <div className="mt-1 text-xs font-medium text-amber-300/80">{alt.cost}</div>}
          <p className="mt-2 text-sm text-zinc-300">{alt.detail}</p>
          {alt.steps && !compact && (
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-zinc-400">
              {alt.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {actionLabel(alt) && (
              <button className="btn-primary" onClick={() => act(alt)}>
                {actionLabel(alt)}
              </button>
            )}
            {alt.link && (
              <a className="btn-ghost" href={alt.link} target="_blank" rel="noreferrer">
                Open site <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorBox({
  error,
  onManual,
  onUpload,
  onDismiss,
}: {
  error: unknown;
  onManual?: () => void;
  onUpload?: () => void;
  onDismiss?: () => void;
}) {
  if (!error) return null;
  const e =
    error instanceof ApiError
      ? error
      : new ApiError(
          typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error),
          0,
        );
  return (
    <div className="space-y-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-rose-200">{e.message}</div>
          {e.hint && <div className="mt-1 text-sm whitespace-pre-wrap text-zinc-400">{e.hint}</div>}
        </div>
        {onDismiss && (
          <button className="text-zinc-500 hover:text-zinc-200" onClick={onDismiss}>
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {e.alternatives?.length ? (
        <>
          <div className="text-xs font-medium tracking-wide text-zinc-400 uppercase">What you can do</div>
          <Alternatives alternatives={e.alternatives} onManual={onManual} onUpload={onUpload} compact />
        </>
      ) : null}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 p-10 text-center">
      {icon && <div className="text-zinc-500">{icon}</div>}
      <div className="font-medium">{title}</div>
      {children && <div className="max-w-md text-sm text-zinc-400">{children}</div>}
    </div>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}
