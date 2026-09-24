import { withService, type Q } from "../db";
import { captureError } from "../monitoring";

export interface JobRow {
  id: string;
  type: string;
  payload: any;
  attempts: number;
  max_attempts: number;
  dedupe_key: string | null;
}

export type JobHandler = (payload: any, q: Q, job: JobRow) => Promise<void>;

/** Enqueue a job. With a dedupe key the same logical job is only ever queued once. */
export async function enqueue(
  q: Q,
  type: string,
  payload: Record<string, unknown> = {},
  opts: { dedupeKey?: string; runAt?: Date; maxAttempts?: number } = {},
): Promise<boolean> {
  const n = await q.exec(
    `insert into jobs (type, payload, dedupe_key, run_at, max_attempts) values ($1,$2,$3,$4,$5)
     on conflict (dedupe_key) do nothing`,
    [type, JSON.stringify(payload), opts.dedupeKey ?? null, opts.runAt ?? new Date(), opts.maxAttempts ?? 5],
  );
  return n > 0;
}

export function backoffMs(attempt: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1)); // 30s, 60s, 2m, 4m ... capped at 1h
}

/**
 * Claims and runs due jobs. Each job runs in its own transaction; on failure it is retried with
 * exponential backoff, and after max_attempts it moves to status 'dead' (the dead-letter queue,
 * visible and retryable in the admin dashboard).
 */
export async function runDueJobs(handlers: Record<string, JobHandler>, limit = 25): Promise<{ ran: number; failed: number; dead: number }> {
  const claimed = await withService((q) =>
    q.many<JobRow>(
      `update jobs set status = 'running', locked_at = now(), attempts = attempts + 1
       where id in (
         select id from jobs
         where (status = 'pending' and run_at <= now())
            or (status = 'running' and locked_at < now() - interval '15 minutes')
         order by run_at limit $1 for update skip locked)
       returning id, type, payload, attempts, max_attempts, dedupe_key`,
      [limit],
    ),
  );
  let failed = 0;
  let dead = 0;
  for (const job of claimed) {
    const handler = handlers[job.type];
    try {
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      await withService((q) => handler(job.payload, q, job));
      await withService((q) => q.exec("update jobs set status = 'done', finished_at = now(), last_error = null where id = $1", [job.id]));
    } catch (e) {
      failed++;
      const msg = (e as Error).message ?? String(e);
      const isDead = job.attempts >= job.max_attempts;
      if (isDead) dead++;
      await withService((q) =>
        q.exec(
          `update jobs set status = $2, last_error = $3, run_at = $4, locked_at = null, finished_at = case when $2 = 'dead' then now() end where id = $1`,
          [job.id, isDead ? "dead" : "pending", msg.slice(0, 2000), new Date(Date.now() + backoffMs(job.attempts))],
        ),
      );
      if (isDead) await captureError(e, { job: job.type, jobId: job.id, deadLetter: true });
    }
  }
  return { ran: claimed.length, failed, dead };
}

export async function retryDeadJob(q: Q, id: string) {
  await q.exec("update jobs set status = 'pending', attempts = 0, run_at = now(), last_error = null where id = $1 and status = 'dead'", [id]);
}
