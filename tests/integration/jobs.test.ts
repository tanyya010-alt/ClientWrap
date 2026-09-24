import { describe, expect, it } from "vitest";
import { withService } from "@/lib/db";
import { enqueue, runDueJobs, retryDeadJob } from "@/lib/jobs/queue";

describe("job queue", () => {
  it("dedupes, retries with backoff, and dead-letters after max attempts", async () => {
    const key = `t-${Date.now()}`;
    const first = await withService((q) => enqueue(q, "test.fail", {}, { dedupeKey: key, maxAttempts: 2 }));
    const second = await withService((q) => enqueue(q, "test.fail", {}, { dedupeKey: key, maxAttempts: 2 }));
    expect([first, second]).toEqual([true, false]);
    let calls = 0;
    const handlers = { "test.fail": async () => { calls++; throw new Error("boom"); } };
    await runDueJobs(handlers);
    let job = await withService((q) => q.one("select * from jobs where dedupe_key = $1", [key]));
    expect(job).toMatchObject({ status: "pending", attempts: 1, last_error: "boom" });
    await withService((q) => q.exec("update jobs set run_at = now() where id = $1", [job.id]));
    const r = await runDueJobs(handlers);
    expect(r.dead).toBe(1);
    job = await withService((q) => q.one("select * from jobs where id = $1", [job.id]));
    expect(job.status).toBe("dead");
    expect(calls).toBe(2);
    await withService((q) => retryDeadJob(q, job.id));
    await runDueJobs({ "test.fail": async () => {} });
    job = await withService((q) => q.one("select * from jobs where id = $1", [job.id]));
    expect(job.status).toBe("done");
  });
});
