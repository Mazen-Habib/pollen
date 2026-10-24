import { errorBody } from "./errors.ts";
import { now } from "./db.ts";

/** Long AI tasks run here so the browser can close the dialog and keep working. */
export type Job = {
  id: string;
  kind: "analyze" | "transcribe";
  reelId: string;
  label: string;
  status: "running" | "done" | "error";
  startedAt: number;
  finishedAt?: number;
  error?: ReturnType<typeof errorBody>;
};

const KEEP_FINISHED_MS = 15 * 60_000;
const jobs = new Map<string, Job>();

function prune() {
  const cutoff = now() - KEEP_FINISHED_MS;
  for (const [id, job] of jobs) if (job.finishedAt && job.finishedAt < cutoff) jobs.delete(id);
}

/** Start a job for a Reel, or return the one already running for the same Reel and kind. */
export function startReelJob(kind: Job["kind"], reelId: string, label: string, task: () => Promise<unknown>): Job {
  prune();
  const id = `${kind}:${reelId}`;
  const existing = jobs.get(id);
  if (existing?.status === "running") return existing;
  const job: Job = { id, kind, reelId, label, status: "running", startedAt: now() };
  jobs.set(id, job);
  task()
    .then(() => {
      job.status = "done";
    })
    .catch((err) => {
      job.status = "error";
      job.error = errorBody(err);
      if (!(err as { status?: number })?.status) console.error(`[job ${id}]`, err);
    })
    .finally(() => {
      job.finishedAt = now();
    });
  return job;
}

export function listJobs(): Job[] {
  prune();
  return [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
}

/** The most relevant job for a Reel: a running one, else the latest finished one. */
export function reelJob(reelId: string): Job | null {
  const mine = listJobs().filter((j) => j.reelId === reelId);
  return mine.find((j) => j.status === "running") ?? mine[0] ?? null;
}
