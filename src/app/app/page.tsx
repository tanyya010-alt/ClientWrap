import Link from "next/link";
import { requireApp, inTenant } from "@/lib/auth";
import { Badge, Card, LinkButton, PageHeader, Alert } from "@/components/ui";
import { usageSnapshot, USAGE_LABELS, type UsageMetric } from "@/lib/entitlements";
import { UsageMeter } from "@/components/usage-meter";
import { formatMoney } from "@/lib/time";
import { ActionForm, SubmitButton } from "@/components/forms";
import { removeDemoAction } from "../onboarding/actions";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireApp();
  const data = await inTenant(ctx, async (q) => {
    const clients = await q.many("select id, name, is_demo from clients where archived_at is null order by created_at");
    const checklist = await q.one(`select
      (select count(*) from clients)::int as clients,
      (select count(*) from metric_events)::int as events,
      (select count(*) from reports)::int as reports,
      (select count(*) from reports where status = 'sent')::int as sent_reports,
      (select count(*) from invoices)::int as invoices`);
    const money = await q.many(
      `select currency, sum(total_cents) filter (where status = 'open')::bigint as open,
              sum(total_cents) filter (where status = 'open' and due_date < current_date)::bigint as overdue,
              sum(total_cents) filter (where status = 'paid' and paid_at > date_trunc('month', now()))::bigint as paid_month
       from invoices group by currency`,
    );
    const recent = await q.many(
      `select m.*, c.name as client_name from message_log m left join clients c on c.id = m.client_id order by m.created_at desc limit 8`,
    );
    const drafts = await q.many(
      `select r.id, r.period, r.client_id, c.name from reports r join clients c on c.id = r.client_id where r.status = 'draft' order by r.updated_at desc limit 5`,
    );
    const usage = await usageSnapshot(q, ctx.workspace.id, ctx.entitlement);
    return { clients, checklist, money, recent, drafts, usage };
  });
  const c = data.checklist;
  const steps = [
    { done: Boolean(ctx.workspace.onboarding_completed_at) || ctx.workspace.logo_data || ctx.workspace.brand_color !== "#4f46e5", label: "Set up your brand", href: "/app/settings#branding" },
    { done: c.clients > 0, label: "Add your first client", href: "/app/clients/new" },
    { done: c.events > 0, label: "Add results (manual, CSV or webhook)", href: data.clients[0] ? `/app/clients/${data.clients[0].id}/data` : "/app/clients/new" },
    { done: c.reports > 0, label: "Generate a monthly wrap", href: data.clients[0] ? `/app/clients/${data.clients[0].id}` : "/app/clients/new" },
    { done: c.sent_reports > 0, label: "Send your first wrap", href: data.clients[0] ? `/app/clients/${data.clients[0].id}` : "/app/clients/new" },
    { done: c.invoices > 0, label: "Create an invoice", href: "/app/invoices/new" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return (
    <>
      <PageHeader
        title={`Hi ${ctx.user.name?.split(" ")[0] ?? "there"} 👋`}
        subtitle={ctx.workspace.name}
        actions={
          <>
            <LinkButton href="/app/clients/new">New client</LinkButton>
            <LinkButton href="/app/invoices/new" variant="secondary">New invoice</LinkButton>
          </>
        }
      />
      {data.clients.some((c) => c.is_demo) && (
        <div className="mb-4">
          <Alert>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{sp.demo ? "Demo workspace loaded: explore the sample clients, their results pages and invoices." : "You have demo clients in your workspace."} Demo data doesn't count toward your limits and is never emailed.</span>
              <ActionForm action={removeDemoAction} className="inline" confirm="Remove all demo clients and their data?">
                <SubmitButton variant="secondary" className="!py-1 !text-xs">Remove demo data</SubmitButton>
              </ActionForm>
            </div>
          </Alert>
        </div>
      )}
      {sp.verified && (
        <div className="mb-4">
          <Alert tone="success">Email confirmed. You're all set to send reports.</Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {doneCount < steps.length && (
            <Card title={`Get set up (${doneCount}/${steps.length})`} actions={<Link href="/onboarding" className="text-sm font-medium text-indigo-600">Guided setup →</Link>}>
              <ol className="space-y-2">
                {steps.map((s) => (
                  <li key={s.label} className="flex items-center gap-3 text-sm">
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${s.done ? "bg-emerald-500 text-white" : "border border-slate-300 text-slate-400"}`}>{s.done ? "✓" : ""}</span>
                    {s.done ? <span className="text-slate-500 line-through">{s.label}</span> : <Link className="font-medium text-slate-800 hover:text-indigo-600" href={s.href}>{s.label}</Link>}
                  </li>
                ))}
              </ol>
            </Card>
          )}
          <Card title="Money">
            {data.money.length === 0 ? (
              <p className="text-sm text-slate-600">No invoices yet. <Link className="text-indigo-600" href="/app/invoices/new">Create one</Link>.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-3">
                {data.money.map((m) => (
                  <div key={m.currency} className="contents">
                    <Stat label={`Outstanding (${m.currency})`} value={formatMoney(Number(m.open ?? 0), m.currency)} />
                    <Stat label="Overdue" value={formatMoney(Number(m.overdue ?? 0), m.currency)} tone={Number(m.overdue) > 0 ? "red" : undefined} />
                    <Stat label="Paid this month" value={formatMoney(Number(m.paid_month ?? 0), m.currency)} tone="green" />
                  </div>
                ))}
              </div>
            )}
          </Card>
          {data.drafts.length > 0 && (
            <Card title="Drafts waiting for review">
              <ul className="divide-y divide-slate-100">
                {data.drafts.map((d) => (
                  <li key={d.id} className="flex items-center justify-between py-2 text-sm">
                    <span>{d.name} · {d.period}</span>
                    <Link className="font-medium text-indigo-600" href={`/app/clients/${d.client_id}/reports/${d.id}`}>Review →</Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Recent messages" actions={<Link href="/app/messages" className="text-sm text-indigo-600">Full log →</Link>}>
            {data.recent.length === 0 ? (
              <p className="text-sm text-slate-600">Nothing sent yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {data.recent.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0 truncate">
                      <Badge tone={m.status === "sent" ? "green" : m.status === "failed" ? "red" : "amber"}>{m.status}</Badge>{" "}
                      <span className="text-slate-500">{m.kind}</span> · {m.client_name ?? "—"} · {m.subject ?? m.step_key}
                    </span>
                    <span className="text-xs text-slate-500">{new Date(m.created_at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="This month's usage" actions={<Link href="/app/billing" className="text-sm text-indigo-600">Plan →</Link>}>
            <div className="space-y-3">
              <UsageMeter label="Client workspaces" used={data.usage.clients.used} max={data.usage.clients.max} />
              {(Object.keys(USAGE_LABELS) as UsageMetric[]).map((k) => (
                <UsageMeter key={k} label={USAGE_LABELS[k]} used={data.usage[k].used} max={data.usage[k].max} />
              ))}
            </div>
          </Card>
          <Card title="Clients" actions={<Link href="/app/clients" className="text-sm text-indigo-600">All →</Link>}>
            {data.clients.length === 0 ? (
              <p className="text-sm text-slate-600">
                No clients yet. <Link className="text-indigo-600" href="/app/clients/new">Add one</Link> or{" "}
                <Link className="text-indigo-600" href="/onboarding?step=demo">load the demo workspace</Link>.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.clients.slice(0, 10).map((cl) => (
                  <li key={cl.id}>
                    <Link href={`/app/clients/${cl.id}`} className="text-slate-800 hover:text-indigo-600">{cl.name}</Link> {cl.is_demo && <Badge>demo</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "red" | "green" }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${tone === "red" ? "text-rose-600" : tone === "green" ? "text-emerald-700" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}
