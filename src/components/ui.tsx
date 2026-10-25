import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
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
  return <Loader2 aria-hidden className={`animate-spin ${className}`} />;
}

/** Icon-only button: always has an accessible name and a 28px hit area. */
export function IconButton({
  label,
  tone,
  className = "",
  children,
  ...rest
}: { label: string; tone?: "danger" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`icon-btn ${tone === "danger" ? "hover:bg-danger/10 hover:text-danger" : ""} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
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
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[8vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`card w-full ${wide ? "max-w-3xl" : "max-w-lg"} p-5 shadow-float`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <IconButton label="Close" onClick={onClose}>
            <X className="h-5 w-5" />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Replaces window.confirm: Cancel is the default, the destructive action is clearly marked. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="space-y-5">
        <div className="text-sm text-fg-2">{message}</div>
        <div className="flex justify-end gap-2">
          <button ref={cancelRef} className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn bg-danger text-surface hover:opacity-90" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export type MenuItem =
  | { kind?: "item"; label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; checked?: boolean; hint?: string }
  | { kind: "separator" }
  | { kind: "heading"; label: string };

/** Right-click menu: arrow keys, Home/End, Enter and Escape work; clicking outside closes it. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
    el.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')?.focus();
  }, [x, y]);

  useEffect(() => {
    const close = (e: Event) => {
      if (e.type === "mousedown" && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("wheel", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const entries = [...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const i = entries.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      entries[(n + entries.length) % entries.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(entries.length - 1);
    else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 max-h-[70vh] max-w-80 min-w-56 overflow-y-auto rounded-xl border border-line bg-surface p-1 text-sm shadow-float"
      style={pos}
    >
      {items.map((item, i) => {
        if (item.kind === "separator") return <div key={i} role="separator" className="my-1 h-px bg-line" />;
        if (item.kind === "heading") {
          return (
            <div key={i} className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-fg-3">
              {item.label}
            </div>
          );
        }
        return (
          <button
            key={i}
            type="button"
            role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={item.checked}
            className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left outline-none hover:bg-surface-2 focus-visible:bg-surface-2 ${
              item.danger ? "text-danger" : "text-fg"
            }`}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.checked !== undefined && (
              <span className="flex w-4 shrink-0 justify-center" aria-hidden>
                {item.checked && <Check className="h-4 w-4 text-fg" />}
              </span>
            )}
            <span className="flex w-4 shrink-0 justify-center text-fg-3" aria-hidden>
              {item.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.hint && <span className="text-xs text-fg-3">{item.hint}</span>}
          </button>
        );
      })}
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
        <div key={alt.id} className="flex flex-col rounded-xl border border-line bg-canvas p-4">
          <div className="flex items-start gap-2 font-medium text-fg">
            <Zap aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-fg-3" /> {alt.title}
          </div>
          {alt.cost && <div className="mt-1 pl-6 text-xs font-medium text-fg-2">{alt.cost}</div>}
          <p className="mt-2 text-sm text-fg-2">{alt.detail}</p>
          {alt.steps && !compact && (
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-fg-2">
              {alt.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          )}
          <div className="mt-auto flex flex-wrap gap-2 pt-3">
            {actionLabel(alt) && (
              <button className="btn-primary" onClick={() => act(alt)}>
                {actionLabel(alt)}
              </button>
            )}
            {alt.link && (
              <a className="btn-ghost" href={alt.link} target="_blank" rel="noreferrer">
                Open site <ExternalLink aria-hidden className="h-3.5 w-3.5" />
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
    <div role="alert" className="space-y-3 rounded-xl border border-danger/30 bg-danger/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-danger">{e.message}</div>
          {e.hint && <div className="mt-1 text-sm whitespace-pre-wrap text-fg-2">{e.hint}</div>}
        </div>
        {onDismiss && (
          <IconButton label="Dismiss" onClick={onDismiss} className="-m-1">
            <X className="h-4 w-4" />
          </IconButton>
        )}
      </div>
      {e.alternatives?.length ? (
        <>
          <div className="text-xs font-medium tracking-wide text-fg-2 uppercase">What you can do</div>
          <Alternatives alternatives={e.alternatives} onManual={onManual} onUpload={onUpload} compact />
        </>
      ) : null}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 p-10 text-center">
      {icon && (
        <div className="text-fg-3" aria-hidden>
          {icon}
        </div>
      )}
      <div className="font-medium">{title}</div>
      {children && <div className="max-w-md text-sm text-fg-2">{children}</div>}
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
