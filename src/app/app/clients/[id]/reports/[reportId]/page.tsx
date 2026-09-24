import Link from "next/link";
import { notFound } from "next/navigation";
import { requireApp, inTenant } from "@/lib/auth";
import { Alert, Badge, Card, PageHeader, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { MetricCard } from "@/components/metric-card";
import { deleteReportAction, generateReportAction, saveReportAction, sendReportAction } from "../../../actions";
import type { ReportSnapshot } from "@/lib/reports";
import { aiConfigured } from "@/lib/ai";

export default async function ReportEditor({ params, searchParams }: { params: Promise<{ id: string; reportId: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id, reportId } = await params;
  const sp = await searchParams;
  const ctx = await requireApp();
  const data = await inTenant(ctx, async (q) => {
    const report = await q.maybe("select * from reports where id = $1 and client_id = $2", [reportId, id]);
    if (!report) return null;
    const client = await q.one("select * from clients where id = $1", [id]);
    const log = await q.many("select * from message_log where report_id = $1 order by created_at desc", [reportId]);
    return { report, client, log };
  });
  if (!data) notFound();
  const { report, client } = data;
  const snap = report.data_snapshot as ReportSnapshot;
  const color = client.brand_color || ctx.workspace.brand_color;
  const shown = snap.metrics.filter((m) => m.value !== null || m.previous !== null);
  return (
    <>
      <PageHeader
        title={`${client.name}: ${snap.periodLabel}`}
        subtitle={<span className="flex items-center gap-2"><Badge tone={report.status === "sent" ? "green" : "amber"}>{report.status}</Badge>{report.ai_generated ? "Summary written by AI from your data. Review it before sending." : "Summary generated from your data. Edit freely."}</span>}
        actions={
          <>
            <Link href={`/app/clients/${id}`} className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium">← Back</Link>
            <a href={`/api/reports/${reportId}/pdf`} className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium">Download PDF</a>
          </>
        }
      />
      {sp.ai_error && <div className="mb-4"><Alert tone="warning">AI summary unavailable ({sp.ai_error}). We used the built-in summary instead.</Alert></div>}
      {!aiConfigured(ctx.workspace) && (
        <div className="mb-4"><Alert>Want AI-written summaries? Add your own Anthropic or OpenAI key in <a className="font-semibold underline" href="/app/settings#integrations">Settings → Integrations</a>. Without a key, ClientWrap writes a clear summary from your numbers.</Alert></div>
      )}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card title="Headline numbers" actions={
            <ActionForm action={generateReportAction.bind(null, id)} className="inline">
              <input type="hidden" name="period" value={report.period} />
              <SubmitButton variant="secondary" className="!px-2.5 !py-1 !text-xs" pendingText="Refreshing…">Refresh numbers</SubmitButton>
            </ActionForm>
          }>
            {shown.length === 0 ? (
              <Alert tone="warning">No data for this month yet. <Link className="font-semibold underline" href={`/app/clients/${id}/data`}>Add results</Link>, then refresh.</Alert>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">{shown.map((m) => <MetricCard key={m.key} m={m} color={color} />)}</div>
            )}
          </Card>
          <Card title="Summary & next step">
            <ActionForm action={saveReportAction.bind(null, reportId)}>
              <label className="block text-sm font-medium text-slate-700" htmlFor="narrative">What changed</label>
              <Textarea id="narrative" name="narrative" rows={8} defaultValue={report.narrative} />
              <label className="block text-sm font-medium text-slate-700" htmlFor="next_step">Suggested next step</label>
              <Textarea id="next_step" name="next_step" rows={3} defaultValue={report.next_step} />
              <div className="flex flex-wrap gap-2">
                <SubmitButton variant="secondary">Save draft</SubmitButton>
              </div>
            </ActionForm>
            <ActionForm action={generateReportAction.bind(null, id)} className="mt-3" confirm="Rewrite the summary and next step from the latest data? Your edits will be replaced.">
              <input type="hidden" name="period" value={report.period} />
              <input type="hidden" name="regenerate" value="1" />
              <SubmitButton variant="secondary" className="!text-xs" pendingText="Writing…">Rewrite summary{aiConfigured(ctx.workspace) ? " with AI" : ""}</SubmitButton>
            </ActionForm>
          </Card>
        </div>
        <div className="space-y-4 lg:col-span-2">
          <Card title="Send">
            <p className="text-sm text-slate-600">
              Emails <strong>{client.contact_email ?? "(no contact email)"}</strong> the summary, the PDF and a link to their results page.
            </p>
            {!client.contact_email && <div className="mt-3"><Alert tone="warning">Add a contact email in <Link className="underline" href={`/app/clients/${id}/settings`}>Client settings</Link> first.</Alert></div>}
            <ActionForm action={sendReportAction.bind(null, reportId)} className="mt-4 space-y-3">
              <SubmitButton pendingText="Sending…">{report.status === "sent" ? "Send again" : "Send to client"}</SubmitButton>
            </ActionForm>
            <ActionForm action={sendReportAction.bind(null, reportId)} className="mt-2">
              <input type="hidden" name="test" value="1" />
              <SubmitButton variant="secondary" className="!text-xs">Send a test to me</SubmitButton>
            </ActionForm>
            {report.sent_at && <p className="mt-3 text-xs text-slate-500">Last sent {new Date(report.sent_at).toLocaleString()} to {report.sent_to}.</p>}
          </Card>
          <Card title="Delivery log">
            {data.log.length === 0 ? <p className="text-sm text-slate-500">Not sent yet.</p> : (
              <ul className="space-y-2 text-xs">
                {data.log.map((m) => (
                  <li key={m.id}><Badge tone={m.status === "sent" ? "green" : m.status === "failed" ? "red" : "amber"}>{m.status}</Badge> {m.recipient} · {new Date(m.created_at).toLocaleString()} {m.skip_reason || m.error ? `· ${m.skip_reason ?? m.error}` : ""}</li>
                ))}
              </ul>
            )}
          </Card>
          <form action={deleteReportAction.bind(null, id, reportId)}>
            <button className="text-sm text-rose-600 hover:underline">Delete this wrap</button>
          </form>
        </div>
      </div>
    </>
  );
}
