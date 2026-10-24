import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { api, jobEvents, type Job } from "../api.ts";
import { Spinner } from "./ui.tsx";
import { ReelDetail } from "./reels.tsx";

/** Bottom-right notifications for background analysis/transcription, visible on every page. */
export function JobsTray() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [openReel, setOpenReel] = useState<string | null>(null);
  const seen = useRef(new Map<string, Job["status"]>()); // jobs this tab has watched running
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = async () => {
    if (timer.current) clearTimeout(timer.current);
    const list = await api<Job[]>("/jobs").catch(() => [] as Job[]);
    for (const job of list) {
      const before = seen.current.get(job.id);
      if (job.status === "running") seen.current.set(job.id, "running");
      else if (before === "running") {
        seen.current.set(job.id, job.status);
        jobEvents.dispatchEvent(new CustomEvent("finished", { detail: job }));
      }
    }
    setJobs(list.filter((j) => seen.current.has(j.id)));
    if (list.some((j) => j.status === "running")) timer.current = setTimeout(poll, 2500);
  };

  useEffect(() => {
    poll();
    const onStart = () => poll();
    jobEvents.addEventListener("started", onStart);
    return () => {
      jobEvents.removeEventListener("started", onStart);
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const key = (j: Job) => `${j.id}:${j.startedAt}`;
  const headline = (j: Job) => {
    const verb = j.kind === "analyze" ? ["Analyzing", "analyzed", "Analysis"] : ["Transcribing", "transcribed", "Transcription"];
    return j.status === "running" ? `${verb[0]} ${j.label}` : j.status === "done" ? `${j.label} ${verb[1]}` : `${verb[2]} failed: ${j.label}`;
  };
  const visible = jobs.filter((j) => !dismissed.has(key(j)));
  const dismiss = (j: Job) => setDismissed((d) => new Set(d).add(key(j)));

  return (
    <>
      {visible.length > 0 && (
        <div className="fixed bottom-4 left-1/2 z-40 w-80 -translate-x-1/2 space-y-2">
          {visible.map((j) => (
            <div key={key(j)} className="card flex items-start gap-3 bg-zinc-900 p-3 shadow-2xl">
              <div className="pt-0.5">
                {j.status === "running" ? (
                  <Spinner className="h-4 w-4 text-amber-400" />
                ) : j.status === "done" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-rose-400" />
                )}
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium text-zinc-100">{headline(j)}</div>
                <div className="text-xs text-zinc-400">
                  {j.status === "running"
                    ? "Running in the background. Keep working."
                    : j.status === "done"
                      ? j.kind === "analyze"
                        ? "Breakdown ready."
                        : "Transcript ready."
                      : j.error?.error}
                </div>
                {j.status !== "running" && (
                  <button
                    className="mt-1 text-xs font-medium text-amber-300 hover:underline"
                    onClick={() => {
                      setOpenReel(j.reelId);
                      dismiss(j);
                    }}
                  >
                    {j.status === "done" ? "View" : "See details"} →
                  </button>
                )}
              </div>
              {j.status !== "running" && (
                <button className="text-zinc-500 hover:text-zinc-200" onClick={() => dismiss(j)}>
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {openReel && <ReelDetail reelId={openReel} onClose={() => setOpenReel(null)} />}
    </>
  );
}
