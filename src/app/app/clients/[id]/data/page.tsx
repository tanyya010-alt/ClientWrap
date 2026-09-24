import { notFound } from "next/navigation";
import { requireApp, inTenant } from "@/lib/auth";
import { Alert, Badge, Card, PageHeader, Help } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ClientTabs } from "@/components/client-tabs";
import { ManualEntry } from "@/components/manual-entry";
import { CsvImporter } from "@/components/csv-importer";
import { WebhookPanel } from "@/components/webhook-panel";
import { addMetricsAction, createWebhookAction, deleteEventAction, importCsvAction, previewCsvAction, revealWebhookSecret, revokeWebhookAction } from "../../actions";
import { env } from "@/lib/env";
import { can } from "@/lib/tiers";
import { formatNumber } from "@/lib/time";
import { orderedMetrics } from "@/lib/templates";

export default async function ClientData({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireApp();
  const data = await inTenant(ctx, async (q) => {
    const client = await q.maybe("select * from clients where id = $1", [id]);
    if (!client) return null;
    const events = await q.many("select * from metric_events where client_id = $1 order by occurred_at desc, created_at desc limit 50", [id]);
    const hook = await q.maybe("select * from webhook_secrets where client_id = $1 and revoked_at is null", [id]);
    const imports = await q.many("select * from csv_imports where client_id = $1 order by created_at desc limit 5", [id]);
    return { client, events, hook, imports };
  });
  if (!data) notFound();
  const cfg = data.client.metric_config as Record<string, { label: string; unit: string; hidden?: boolean }>;
  const metrics = orderedMetrics(cfg).filter(([, v]) => !v.hidden).map(([key, v]) => ({ key, label: v.label, unit: v.unit }));
  const lastMonthEnd = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 0)).toISOString().slice(0, 10);
  const canHook = can(ctx.entitlement, "metrics_webhook");
  return (
    <>
      <PageHeader title={data.client.name} subtitle="Results data: in the client's own units" />
      <ClientTabs id={id} active="data" />
      {sp.new && (
        <div className="mb-6">
          <Alert tone="success">Client created. Add last month's numbers below, then generate your first wrap from the Overview tab.</Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Enter numbers" actions={<Help href="/help/reports">How metrics work</Help>}>
          <ManualEntry action={addMetricsAction.bind(null, id)} metrics={metrics} defaultDate={lastMonthEnd} />
        </Card>
        <Card title="Import a CSV" actions={<Help href="/help/csv-import">CSV guide</Help>}>
          <p className="mb-3 text-sm text-slate-600">Map any spreadsheet export. Rows with problems are skipped and listed in an error report; re-importing the same file never duplicates values.</p>
          <CsvImporter preview={previewCsvAction} importCsv={importCsvAction.bind(null, id)} />
          {data.imports.length > 0 && (
            <ul className="mt-4 space-y-1 text-xs text-slate-500">
              {data.imports.map((i) => (
                <li key={i.id}>{new Date(i.created_at).toLocaleString()}: {i.filename}: {i.rows_imported}/{i.rows_total} imported{(i.errors as any[]).length ? `, ${(i.errors as any[]).length} errors` : ""}</li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Automate with a webhook" className="lg:col-span-2" actions={<Help href="/help/webhook">Webhook docs</Help>}>
          {!canHook ? (
            <Alert>The metrics webhook is included from the Solo plan. <a className="font-semibold underline" href="/app/billing">See plans</a>.</Alert>
          ) : data.hook ? (
            <>
              <WebhookPanel url={`${env.APP_URL}/api/ingest/${data.hook.public_token}`} reveal={revealWebhookSecret.bind(null, id)} />
              <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span>Last used: {data.hook.last_used_at ? new Date(data.hook.last_used_at).toLocaleString() : "never"}</span>
                <ActionForm action={createWebhookAction.bind(null, id)} className="inline" confirm="Generate a new URL and secret? The current ones stop working immediately.">
                  <SubmitButton variant="secondary" className="!px-2.5 !py-1 !text-xs">Regenerate secret</SubmitButton>
                </ActionForm>
                <ActionForm action={revokeWebhookAction.bind(null, id)} className="inline" confirm="Disable this webhook?">
                  <SubmitButton variant="secondary" className="!px-2.5 !py-1 !text-xs">Disable</SubmitButton>
                </ActionForm>
              </div>
            </>
          ) : (
            <ActionForm action={createWebhookAction.bind(null, id)}>
              <p className="text-sm text-slate-600">Send results from n8n, Make, Zapier or your own code. Each client gets its own URL and signing secret; events are de-duplicated with an idempotency key.</p>
              <SubmitButton>Create webhook</SubmitButton>
            </ActionForm>
          )}
        </Card>
        <Card title="Recent values" className="lg:col-span-2">
          {data.events.length === 0 ? (
            <p className="text-sm text-slate-500">No data yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-500">
                  <tr><th className="py-2">Date</th><th>Metric</th><th className="pr-2 text-right">Value</th><th className="pl-2">Unit</th><th>Source</th><th></th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.events.map((e) => (
                    <tr key={e.id}>
                      <td className="py-2">{new Date(e.occurred_at).toISOString().slice(0, 10)}</td>
                      <td>{cfg[e.metric]?.label ?? e.metric}</td>
                      <td className="pr-2 text-right tabular-nums">{formatNumber(Number(e.value))}</td>
                      <td className="pl-2 text-slate-500">{e.unit}</td>
                      <td><Badge>{e.source}</Badge></td>
                      <td className="text-right">
                        <form action={deleteEventAction.bind(null, id, e.id)}>
                          <button className="text-xs text-rose-600 hover:underline" aria-label="Delete value">Delete</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
