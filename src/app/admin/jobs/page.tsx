import { requireAdmin } from "@/lib/auth";
import { withService } from "@/lib/db";
import { Badge, Card } from "@/components/ui";
import { retryJobAction } from "../actions";

export default async function JobsPage() {
  await requireAdmin();
  const d = await withService(async (q) => ({
    dead: await q.many("select * from jobs where status = 'dead' order by finished_at desc limit 100"),
    stats: await q.many("select type, status, count(*)::int as n from jobs group by type, status order by type, status"),
    errors: await q.many("select * from error_events order by created_at desc limit 50"),
    support: await q.many("select * from support_tickets order by created_at desc limit 20"),
  }));
  return (
    <div className="space-y-6">
      <Card title="Job queue">
        <table className="w-full text-sm"><tbody>{d.stats.map((s) => <tr key={`${s.type}${s.status}`}><td className="font-mono">{s.type}</td><td>{s.status}</td><td>{s.n}</td></tr>)}</tbody></table>
      </Card>
      <Card title={`Dead-letter queue (${d.dead.length})`}>
        {d.dead.length === 0 ? <p className="text-sm text-slate-500">Empty.</p> : (
          <ul className="space-y-2 text-sm">
            {d.dead.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-2">
                <span><Badge tone="red">{j.type}</Badge> {j.attempts} attempts · {j.last_error} <span className="text-xs text-slate-500">{JSON.stringify(j.payload)}</span></span>
                <form action={retryJobAction.bind(null, j.id)}><button className="rounded border border-slate-300 px-2 py-1 text-xs">Retry</button></form>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Recent errors">
        <ul className="space-y-1 text-xs">{d.errors.map((e) => <li key={e.id}><details><summary>{new Date(e.created_at).toLocaleString()} · {e.message}</summary><pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(e.context)}{"\n"}{e.stack}</pre></details></li>)}</ul>
      </Card>
      <Card title="Recent support messages">
        <ul className="space-y-2 text-sm">{d.support.map((s) => <li key={s.id}><strong>{s.subject}</strong> · {s.email} · {new Date(s.created_at).toLocaleString()}<p className="whitespace-pre-line text-slate-600">{s.message}</p></li>)}</ul>
      </Card>
    </div>
  );
}
