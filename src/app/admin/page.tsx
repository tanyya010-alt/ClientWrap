import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { withService } from "@/lib/db";
import { adminSearch } from "@/lib/admin";
import { Badge, Card, Input } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { reconcileAction } from "./actions";
import { PLANS, planForAppsumoTier } from "@/lib/tiers";

export const metadata = { title: "Admin" };

export default async function AdminHome({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  await requireAdmin();
  const q = sp.q ?? "";
  const [results, stats] = await Promise.all([
    withService((s) => adminSearch(s, q)),
    withService((s) =>
      s.many(`select tier, status, count(*)::int as n, count(user_id)::int as linked from licenses where not test group by tier, status order by tier, status`),
    ),
  ]);
  const totals = await withService((s) => s.one(`select (select count(*) from users)::int as users, (select count(*) from license_events where received_at > now() - interval '24 hours')::int as events24, (select count(*) from license_events where error is not null and processed_at is null)::int as failed_events`));
  return (
    <div className="space-y-6">
      <Card title="Find a license or account">
        <form className="flex gap-2">
          <Input name="q" defaultValue={q} placeholder="License key (full or partial) or email" aria-label="Search" autoFocus />
          <button className="rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white">Search</button>
        </form>
        {q && (
          <div className="mt-4 space-y-4">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500"><tr><th>License key</th><th>Tier</th><th>Status</th><th>Account</th><th>Updated</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {results.licenses.map((l) => (
                  <tr key={l.id}>
                    <td className="py-1.5 font-mono text-xs"><Link className="text-indigo-700" href={`/admin/licenses/${encodeURIComponent(l.license_key)}`}>{l.license_key}</Link></td>
                    <td>{l.tier} ({PLANS[planForAppsumoTier(l.tier)].name})</td>
                    <td><Badge tone={l.status === "active" ? "green" : l.status === "inactive" ? "amber" : "red"}>{l.superseded_by ? "superseded" : l.status}</Badge>{l.refunded && <Badge tone="red">refunded</Badge>}</td>
                    <td>{l.email ?? <span className="text-slate-400">not redeemed</span>}</td>
                    <td className="text-xs">{new Date(l.updated_at).toLocaleString()}</td>
                  </tr>
                ))}
                {results.licenses.length === 0 && <tr><td colSpan={5} className="py-2 text-slate-500">No licenses match.</td></tr>}
              </tbody>
            </table>
            {results.users.length > 0 && (
              <div>
                <p className="text-sm font-semibold">Accounts</p>
                <ul className="text-sm">{results.users.map((u) => <li key={u.id}>{u.email} · {u.workspace_name} · joined {new Date(u.created_at).toLocaleDateString()}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Licenses">
          <p className="mb-2 text-sm text-slate-600">{totals.users} accounts · {totals.events24} license events in 24h · {totals.failed_events} failed events</p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th>Tier</th><th>Status</th><th>Count</th><th>Redeemed</th></tr></thead>
            <tbody>{stats.map((s) => <tr key={`${s.tier}-${s.status}`}><td>{s.tier}</td><td>{s.status}</td><td>{s.n}</td><td>{s.linked}</td></tr>)}</tbody>
          </table>
        </Card>
        <Card title="AppSumo refund reconciliation">
          <p className="mb-3 text-sm text-slate-600">Upload AppSumo's refunded/redeemed codes CSV. Refunded licenses are deactivated through the same path as a webhook (access revoked, 30-day read-only, 24h re-purchase block). Safe to run repeatedly.</p>
          <ActionForm action={reconcileAction}>
            <input type="file" name="file" accept=".csv" required aria-label="AppSumo CSV" className="text-sm" />
            <SubmitButton>Reconcile</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
