import { withService } from "@/lib/db";
import { env } from "@/lib/env";

export const metadata = { title: "System status" };
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function checks() {
  const out: { name: string; ok: boolean; detail: string }[] = [];
  try {
    const t = Date.now();
    const r = await withService((q) =>
      q.one<{ pending: number; dead: number; oldest: string | null; errors: number }>(
        `select (select count(*) from jobs where status='pending')::int as pending,
                (select count(*) from jobs where status='dead' and finished_at > now() - interval '24 hours')::int as dead,
                (select min(run_at) from jobs where status='pending') as oldest,
                (select count(*) from error_events where created_at > now() - interval '1 hour')::int as errors`,
      ),
    );
    out.push({ name: "Web app & API", ok: true, detail: "Operational" });
    out.push({ name: "Database", ok: true, detail: `Responding in ${Date.now() - t} ms` });
    const lag = r.oldest ? Math.round((Date.now() - new Date(r.oldest).getTime()) / 60000) : 0;
    out.push({ name: "Scheduled jobs (reports, reminders)", ok: lag < 30 && r.dead === 0, detail: lag < 30 ? `On schedule (${r.pending} queued)` : `Delayed by ~${lag} min` });
    out.push({ name: "Error rate", ok: r.errors < 25, detail: r.errors < 25 ? "Normal" : "Elevated; we're investigating" });
  } catch {
    out.push({ name: "Database", ok: false, detail: "Unreachable" });
  }
  out.push({ name: "Email delivery", ok: Boolean(env.RESEND_API_KEY) || env.NODE_ENV !== "production", detail: env.RESEND_API_KEY ? "Operational" : "Not configured" });
  return out;
}

export default async function Status() {
  const c = await checks();
  const allOk = c.every((x) => x.ok);
  return (
    <main className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-3xl font-bold">System status</h1>
      <div className={`mt-6 rounded-xl p-4 font-semibold ${allOk ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{allOk ? "All systems operational" : "Some systems are degraded"}</div>
      <ul className="mt-6 divide-y divide-slate-100 rounded-xl border border-slate-200">
        {c.map((x) => (
          <li key={x.name} className="flex items-center justify-between px-4 py-3 text-sm">
            <span>{x.name}</span>
            <span className={x.ok ? "text-emerald-700" : "text-amber-700"}>{x.ok ? "●" : "▲"} {x.detail}</span>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-slate-500">Checked live at {new Date().toUTCString()}. Machine-readable health: <a className="underline" href="/api/health">/api/health</a>. Past incidents are listed in the <a className="underline" href="/changelog">changelog</a>.</p>
    </main>
  );
}
