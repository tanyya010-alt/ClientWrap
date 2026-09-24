import { withService } from "@/lib/db";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    const r = await withService((q) =>
      q.one<{ pending: number; dead: number; oldest: string | null }>(
        `select count(*) filter (where status = 'pending')::int as pending,
                count(*) filter (where status = 'dead')::int as dead,
                min(run_at) filter (where status = 'pending') as oldest
         from jobs`,
      ),
    );
    const lagSeconds = r.oldest ? Math.max(0, Math.round((Date.now() - new Date(r.oldest).getTime()) / 1000)) : 0;
    return json({
      status: "ok",
      db: "ok",
      jobs: { pending: r.pending, dead: r.dead, lagSeconds },
      latencyMs: Date.now() - started,
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.npm_package_version ?? "dev",
    });
  } catch (e) {
    return json({ status: "error", db: "unreachable", error: (e as Error).message }, 503);
  }
}
