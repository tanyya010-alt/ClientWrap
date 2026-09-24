import { requireApp, inTenant } from "@/lib/auth";
import { withUser } from "@/lib/db";
import { Alert, Badge, Card, Input, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { UsageMeter } from "@/components/usage-meter";
import { usageSnapshot, USAGE_LABELS, type UsageMetric } from "@/lib/entitlements";
import { PLANS, PAID_PLANS, PLAN_ORDER, planForAppsumoTier } from "@/lib/tiers";
import { applyLicenseAction, billingPortalAction, checkoutAction } from "./actions";
import { env } from "@/lib/env";

export const metadata = { title: "Plan & usage" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireApp();
  const ent = ctx.entitlement;
  const usage = await inTenant(ctx, (q) => usageSnapshot(q, ctx.workspace.id, ent));
  const { licenses, subs } = await withUser(ctx.user.id, async (q) => ({
    licenses: await q.many("select * from licenses order by created_at desc"),
    subs: await q.many("select * from subscriptions order by updated_at desc"),
  }));
  const plan = PLANS[ent.plan];
  const billingReady = Boolean(env.STRIPE_SECRET_KEY);
  const activeSub = subs.find((s) => ["active", "trialing", "past_due"].includes(s.status));
  return (
    <>
      <PageHeader title="Plan & usage" />
      <div className="mb-6 space-y-3">
        {sp.redeemed === "redeemed" && <Alert tone="success">Your AppSumo license is active. Welcome aboard!</Alert>}
        {sp.redeemed === "pending" && <Alert tone="success">License received from AppSumo. It activates as soon as AppSumo confirms it (usually within a minute); refresh this page.</Alert>}
        {sp.redeem_error && <Alert tone="error">{sp.redeem_error}</Alert>}
        {sp.checkout === "success" && <Alert tone="success">Thanks! Your subscription is being activated; refresh in a few seconds.</Alert>}
        {sp.error === "billing_unavailable" && <Alert tone="error">Online checkout isn't available right now. Please contact support.</Alert>}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Current plan" className="lg:col-span-1">
          <p className="text-2xl font-bold">{plan.name}</p>
          <p className="mt-1 text-sm text-slate-600">
            {ent.source === "appsumo" ? "AppSumo lifetime license" : ent.source === "stripe" ? `Subscription${activeSub ? ` (${activeSub.billing_interval}ly)` : ""}` : "Free plan"}
            {ent.mode === "readonly" && <> · <Badge tone="amber">read-only until {new Date(ent.readonlyUntil!).toLocaleDateString()}</Badge></>}
          </p>
          <ul className="mt-4 space-y-1 text-sm text-slate-700">{plan.highlights.map((h) => <li key={h}>✓ {h}</li>)}</ul>
          {activeSub && (
            <form action={billingPortalAction} className="mt-4">
              <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Manage subscription & invoices</button>
            </form>
          )}
        </Card>
        <Card title="Usage this month" className="lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <UsageMeter label="Client workspaces" used={usage.clients.used} max={usage.clients.max} />
            {(Object.keys(USAGE_LABELS) as UsageMetric[]).map((k) => <UsageMeter key={k} label={USAGE_LABELS[k]} used={usage[k].used} max={usage[k].max} />)}
          </div>
          <p className="mt-4 text-xs text-slate-500">Fair-use limits reset on the 1st of each month (UTC). AI and SMS/WhatsApp run on your own API keys, so ClientWrap never bills you for them. When you reach a limit we tell you exactly what's affected; nothing is deleted.</p>
        </Card>
      </div>

      <Card title="AppSumo license" className="mt-6" id="appsumo">
        {licenses.length > 0 && (
          <ul className="mb-4 space-y-2 text-sm">
            {licenses.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{l.license_key.slice(0, 8)}…{l.license_key.slice(-4)}</code>
                <span>Tier {l.tier} ({PLANS[planForAppsumoTier(l.tier)].name})</span>
                <Badge tone={l.status === "active" ? "green" : l.status === "inactive" ? "amber" : "red"}>{l.superseded_by ? "replaced by upgrade" : l.status}</Badge>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-slate-600">Bought ClientWrap on AppSumo? The fastest way is the <strong>Activate</strong> button on your AppSumo product page. Or paste your license key:</p>
        <ActionForm action={applyLicenseAction} className="mt-3 flex flex-wrap items-start gap-3">
          <Input name="license_key" placeholder="AppSumo license key" aria-label="AppSumo license key" className="max-w-md" required />
          <SubmitButton>Apply license</SubmitButton>
        </ActionForm>
        <p className="mt-2 text-xs text-slate-500">To upgrade or downgrade your tier, use AppSumo; the change applies here automatically.</p>
      </Card>

      <div className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">Plans</h2>
        {!billingReady && <div className="mb-3"><Alert>Online subscriptions are not enabled on this server yet.</Alert></div>}
        <div className="grid gap-4 md:grid-cols-3">
          {PAID_PLANS.map((k) => {
            const p = PLANS[k];
            const current = ent.plan === k && ent.mode === "full";
            const lower = PLAN_ORDER.indexOf(k) < PLAN_ORDER.indexOf(ent.plan);
            return (
              <Card key={k} className={current ? "ring-2 ring-indigo-500" : ""}>
                <p className="font-semibold">{p.name} {current && <Badge tone="indigo">current</Badge>}</p>
                <p className="mt-1 text-2xl font-bold">${p.monthlyPriceUsd}<span className="text-sm font-normal text-slate-500">/mo</span></p>
                <p className="text-xs text-slate-500">or ${p.annualPriceUsd}/year (2 months free)</p>
                <ul className="mt-3 space-y-1 text-sm">{p.highlights.map((h) => <li key={h}>✓ {h}</li>)}</ul>
                {billingReady && !current && !lower && ent.source !== "appsumo" && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <form action={checkoutAction.bind(null, k, "month")}><button className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white">Monthly</button></form>
                    <form action={checkoutAction.bind(null, k, "year")}><button className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium">Annual</button></form>
                  </div>
                )}
                {ent.source === "appsumo" && !current && !lower && <p className="mt-4 text-xs text-slate-500">Upgrade your tier on AppSumo.</p>}
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
