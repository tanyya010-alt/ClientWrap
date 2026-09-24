import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { withService } from "@/lib/db";
import { adminLicenseDetail } from "@/lib/admin";
import { audit } from "@/lib/audit";
import { Alert, Badge, Card } from "@/components/ui";
import { UsageMeter } from "@/components/usage-meter";
import { PLANS, planForAppsumoTier } from "@/lib/tiers";

export default async function LicenseDetail({ params }: { params: Promise<{ key: string }> }) {
  const { key: raw } = await params;
  const key = decodeURIComponent(raw);
  const ctx = await requireAdmin();
  const d = await withService(async (q) => {
    const r = await adminLicenseDetail(q, key);
    await audit(q, { workspaceId: null, userId: ctx.user.id, actor: "admin", action: "admin.license_viewed", targetType: "license", targetId: key });
    return r;
  });
  const l = d.license;
  return (
    <div className="space-y-6">
      <Link href={`/admin?q=${encodeURIComponent(key)}`} className="text-sm text-indigo-600">← Search</Link>
      <h1 className="break-all font-mono text-lg font-semibold">{key}</h1>
      <Alert>Licenses are read-only here. State changes only come from AppSumo webhooks (or the refund CSV reconciliation).</Alert>
      {!l ? (
        <Card title="License not found">
          <p className="text-sm">No purchase/activate webhook has been received for this key.{d.pending ? ` A redemption by ${d.pending.email} is waiting for it (since ${new Date(d.pending.created_at).toLocaleString()}).` : ""}</p>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="License">
            <dl className="grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-slate-500">Status</dt><dd><Badge tone={l.status === "active" ? "green" : l.status === "inactive" ? "amber" : "red"}>{l.status}</Badge> {l.refunded && <Badge tone="red">refunded</Badge>}</dd>
              <dt className="text-slate-500">Tier</dt><dd>{l.tier} ({PLANS[planForAppsumoTier(l.tier)].name})</dd>
              <dt className="text-slate-500">Plan id</dt><dd>{l.plan_id ?? "—"}</dd>
              <dt className="text-slate-500">Purchased</dt><dd>{l.purchased_at ? new Date(l.purchased_at).toLocaleString() : "—"}</dd>
              <dt className="text-slate-500">Activated</dt><dd>{l.activated_at ? new Date(l.activated_at).toLocaleString() : "—"}</dd>
              <dt className="text-slate-500">Redeemed</dt><dd>{l.redeemed_at ? new Date(l.redeemed_at).toLocaleString() : "not yet"}</dd>
              <dt className="text-slate-500">Deactivated</dt><dd>{l.deactivated_at ? `${new Date(l.deactivated_at).toLocaleString()} (${l.deactivation_reason})` : "—"}</dd>
              <dt className="text-slate-500">Previous key</dt><dd className="break-all font-mono text-xs">{l.prev_license_key ? <Link className="text-indigo-700" href={`/admin/licenses/${encodeURIComponent(l.prev_license_key)}`}>{l.prev_license_key}</Link> : "—"}</dd>
              <dt className="text-slate-500">Superseded by</dt><dd className="break-all font-mono text-xs">{l.superseded_by ? <Link className="text-indigo-700" href={`/admin/licenses/${encodeURIComponent(l.superseded_by)}`}>{l.superseded_by}</Link> : "—"}</dd>
              <dt className="text-slate-500">Test</dt><dd>{l.test ? "yes" : "no"}</dd>
            </dl>
          </Card>
          <Card title="Account">
            {!d.account ? <p className="text-sm text-slate-500">Not redeemed by any account yet.</p> : (
              <div className="space-y-3 text-sm">
                <p><strong>{d.account.user.email}</strong> {d.account.user.email_verified_at ? <Badge tone="green">verified</Badge> : <Badge tone="amber">unverified</Badge>}</p>
                <p>Workspace: {d.account.workspace?.name} · joined {new Date(d.account.user.created_at).toLocaleDateString()} · onboarding {d.account.workspace?.onboarding_completed_at ? "done" : "not finished"}</p>
                <p>Effective plan: <strong>{PLANS[d.account.entitlement.plan].name}</strong> ({d.account.entitlement.source}, {d.account.entitlement.mode}{d.account.entitlement.readonlyUntil ? ` until ${new Date(d.account.entitlement.readonlyUntil).toLocaleDateString()}` : ""})</p>
                {d.account.user.refund_block_until && new Date(d.account.user.refund_block_until) > new Date() && <p className="text-rose-700">Re-purchase blocked until {new Date(d.account.user.refund_block_until).toLocaleString()}</p>}
                {d.account.counts && <p>{d.account.counts.clients} clients · {d.account.counts.reports} reports · {d.account.counts.invoices} invoices · last activity {d.account.counts.last_activity ? new Date(d.account.counts.last_activity).toLocaleString() : "—"}</p>}
                {d.account.usage && (
                  <div className="space-y-2">
                    <UsageMeter label="Clients" used={d.account.usage.clients.used} max={d.account.usage.clients.max} />
                    <UsageMeter label="Emails" used={d.account.usage.emails.used} max={d.account.usage.emails.max} />
                    <UsageMeter label="Webhook events" used={d.account.usage.webhook_events.used} max={d.account.usage.webhook_events.max} />
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
      <Card title={`Webhook & license event history (${d.events.length})`}>
        <ul className="space-y-2 text-sm">
          {d.events.map((e) => (
            <li key={e.id} className="rounded-lg border border-slate-200 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="indigo">{e.event}</Badge><Badge>{e.source}</Badge>
                <span className="text-xs text-slate-500">{new Date(e.received_at).toLocaleString()}</span>
                {e.processed_at ? <Badge tone="green">processed</Badge> : e.error ? <Badge tone="red">error: {e.error}</Badge> : <Badge tone="amber">stored</Badge>}
              </div>
              <details className="mt-1"><summary className="cursor-pointer text-xs text-slate-500">payload</summary><pre className="mt-1 overflow-x-auto rounded bg-slate-900 p-2 text-xs text-slate-100">{JSON.stringify(e.payload, null, 2)}</pre></details>
            </li>
          ))}
        </ul>
      </Card>
      {d.account && (
        <Card title="Recent account activity (audit log)">
          <ul className="space-y-1 text-xs">{d.account.audit.map((a) => <li key={a.id}>{new Date(a.created_at).toLocaleString()} · {a.actor} · <span className="font-mono">{a.action}</span></li>)}</ul>
        </Card>
      )}
    </div>
  );
}
