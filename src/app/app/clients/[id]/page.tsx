import Link from "next/link";
import { notFound } from "next/navigation";
import { requireApp, inTenant } from "@/lib/auth";
import { Badge, Card, Field, LinkButton, PageHeader, Select, Alert } from "@/components/ui";
import { ActionForm, CopyButton, SubmitButton } from "@/components/forms";
import { ClientTabs } from "@/components/client-tabs";
import { MetricCard } from "@/components/metric-card";
import { buildSnapshot } from "@/lib/reports";
import { ensurePortalLink, portalUrlFor } from "@/lib/portal";
import { generateReportAction, rotatePortalAction } from "../actions";
import { periodLabel, previousPeriod, formatMoney, toIsoDate } from "@/lib/time";
import { currentPeriod } from "@/lib/entitlements";

export default async function ClientOverview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireApp();
  const data = await inTenant(ctx, async (q) => {
    const client = await q.maybe("select * from clients where id = $1", [id]);
    if (!client) return null;
    const period = currentPeriod();
    const snapshot = await buildSnapshot(q, client, period);
    const lastMonth = await buildSnapshot(q, client, previousPeriod(period));
    const reports = await q.many("select id, period, status, sent_at, ai_generated from reports where client_id = $1 order by period desc", [id]);
    const invoices = await q.many("select * from invoices where client_id = $1 order by created_at desc limit 10", [id]);
    const link = ctx.entitlement.mode === "full" ? await ensurePortalLink(q, ctx.workspace.id, id) : await q.maybe("select * from portal_links where client_id = $1 and revoked_at is null", [id]);
    return { client, snapshot, lastMonth, reports, invoices, link };
  });
  if (!data) notFound();
  const { client } = data;
  const url = data.link ? portalUrlFor(data.link.id, ctx.workspace, ctx.entitlement) : null;
  const cur = currentPeriod();
  const months = [previousPeriod(cur), cur, previousPeriod(previousPeriod(cur)), previousPeriod(previousPeriod(previousPeriod(cur)))];
  const showSnap = data.snapshot.eventCount > 0 ? data.snapshot : data.lastMonth;
  const color = client.brand_color || ctx.workspace.brand_color;
  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">{client.name} {client.is_demo && <Badge>demo</Badge>} {client.archived_at && <Badge tone="amber">archived</Badge>}</span>}
        subtitle={[client.contact_name, client.contact_email].filter(Boolean).join(" · ") || "No contact yet: add one in Client settings"}
        actions={
          <>
            <LinkButton href={`/app/invoices/new?client=${id}`} variant="secondary">New invoice</LinkButton>
            <LinkButton href={`/app/growth?client=${id}`} variant="secondary">Growth</LinkButton>
          </>
        }
      />
      <ClientTabs id={id} active="overview" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title={`Results: ${showSnap.periodLabel}`} actions={<Link href={`/app/clients/${id}/data`} className="text-sm font-medium text-indigo-600">Add data →</Link>}>
            {showSnap.metrics.filter((m) => m.value !== null).length === 0 ? (
              <Alert>No results yet. <Link href={`/app/clients/${id}/data`} className="font-semibold underline">Enter numbers, import a CSV or connect a webhook</Link>. It takes about a minute.</Alert>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {showSnap.metrics.filter((m) => m.value !== null).map((m) => <MetricCard key={m.key} m={m} color={color} />)}
              </div>
            )}
          </Card>
          <Card title="Monthly wraps">
            {sp.error && <div className="mb-3"><Alert tone="error">{sp.error}</Alert></div>}
            <ActionForm action={generateReportAction.bind(null, id)} className="flex flex-wrap items-end gap-3">
              <Field label="Month" htmlFor="period">
                <Select id="period" name="period" defaultValue={months[0]} className="w-48">
                  {months.map((p) => <option key={p} value={p}>{periodLabel(p)}{p === cur ? " (so far)" : ""}</option>)}
                </Select>
              </Field>
              <SubmitButton pendingText="Generating…">Generate wrap</SubmitButton>
            </ActionForm>
            <ul className="mt-4 divide-y divide-slate-100">
              {data.reports.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{periodLabel(r.period)}</span>
                    <Badge tone={r.status === "sent" ? "green" : "amber"}>{r.status === "sent" ? `sent ${new Date(r.sent_at).toLocaleDateString()}` : "draft"}</Badge>
                    {r.ai_generated && <Badge tone="indigo">AI</Badge>}
                  </span>
                  <span className="flex gap-3">
                    <a className="text-slate-600 hover:underline" href={`/api/reports/${r.id}/pdf`}>PDF</a>
                    <Link className="font-medium text-indigo-600" href={`/app/clients/${id}/reports/${r.id}`}>{r.status === "sent" ? "View" : "Edit & send"} →</Link>
                  </span>
                </li>
              ))}
              {data.reports.length === 0 && <li className="py-2 text-sm text-slate-500">No wraps yet. Pick a month and generate your first one.</li>}
            </ul>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Client results page">
            {url ? (
              <>
                <p className="text-sm text-slate-600">Share this private link. No login needed; it always shows the latest results, invoices and next step.</p>
                <div className="mt-3 break-all rounded-lg bg-slate-50 p-2 font-mono text-xs">{url}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <CopyButton text={url} label="Copy link" />
                  <a href={url} target="_blank" className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">Open ↗</a>
                </div>
                <ActionForm action={rotatePortalAction.bind(null, id)} className="mt-3" confirm="Create a new link? The current link will stop working.">
                  <SubmitButton variant="secondary" className="!px-2.5 !py-1 !text-xs">Reset link</SubmitButton>
                </ActionForm>
                <p className="mt-2 text-xs text-slate-500">Viewed {data.link?.view_count ?? 0} times{data.link?.last_viewed_at ? `, last ${new Date(data.link.last_viewed_at).toLocaleString()}` : ""}.</p>
              </>
            ) : (
              <p className="text-sm text-slate-600">The results page is unavailable while your account is read-only.</p>
            )}
          </Card>
          <Card title="Invoices" actions={<Link href={`/app/invoices/new?client=${id}`} className="text-sm text-indigo-600">New →</Link>}>
            {data.invoices.length === 0 ? (
              <p className="text-sm text-slate-500">No invoices yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.invoices.map((i) => (
                  <li key={i.id} className="flex items-center justify-between">
                    <Link href={`/app/invoices/${i.id}`} className="hover:text-indigo-600">{i.number} · {formatMoney(i.total_cents, i.currency)}</Link>
                    <Badge tone={i.status === "paid" ? "green" : i.status === "open" ? (toIsoDate(i.due_date) < new Date().toISOString().slice(0, 10) ? "red" : "blue") : "slate"}>{i.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
            {client.reminders_paused && <p className="mt-3 text-xs text-rose-700">Automatic reminders are paused for this client.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
