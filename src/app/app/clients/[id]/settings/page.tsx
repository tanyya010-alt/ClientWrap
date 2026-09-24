import { notFound } from "next/navigation";
import { requireApp, inTenant } from "@/lib/auth";
import { Alert, Badge, Card, Field, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ClientTabs } from "@/components/client-tabs";
import { archiveClientAction, deleteClientAction, recordConsentAction, saveMetricConfigAction, updateClientAction } from "../../actions";
import { COMMON_TIMEZONES } from "@/lib/timezones";
import { consentState } from "@/lib/messaging";
import { can } from "@/lib/tiers";
import { toIsoDate } from "@/lib/time";
import { orderedMetrics } from "@/lib/templates";

export default async function ClientSettings({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireApp();
  const data = await inTenant(ctx, async (q) => {
    const client = await q.maybe("select * from clients where id = $1", [id]);
    if (!client) return null;
    const consent = await consentState(q, id);
    const history = await q.many("select * from consent_records where client_id = $1 order by created_at desc limit 20", [id]);
    return { client, consent, history };
  });
  if (!data) notFound();
  const c = data.client;
  const cfg = c.metric_config as Record<string, any>;
  return (
    <>
      <PageHeader title={c.name} subtitle="Client settings" />
      <ClientTabs id={id} active="settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Details, branding & schedule">
          <ActionForm action={updateClientAction.bind(null, id)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="name"><Input id="name" name="name" defaultValue={c.name} required /></Field>
              <Field label="Contact name" htmlFor="contact_name"><Input id="contact_name" name="contact_name" defaultValue={c.contact_name ?? ""} /></Field>
              <Field label="Contact email" htmlFor="contact_email"><Input id="contact_email" type="email" name="contact_email" defaultValue={c.contact_email ?? ""} /></Field>
              <Field label="Phone" htmlFor="contact_phone"><Input id="contact_phone" name="contact_phone" defaultValue={c.contact_phone ?? ""} placeholder="+14155550100" /></Field>
              <Field label="Timezone" htmlFor="timezone">
                <Select id="timezone" name="timezone" defaultValue={c.timezone ?? ctx.workspace.timezone}>{COMMON_TIMEZONES.map((t) => <option key={t}>{t}</option>)}</Select>
              </Field>
              <Field label="Portal accent color" htmlFor="brand_color" hint="Defaults to your workspace color.">
                <Input id="brand_color" name="brand_color" type="color" defaultValue={c.brand_color ?? ctx.workspace.brand_color} className="h-10" />
              </Field>
              <Field label="Service description" htmlFor="service_description"><Input id="service_description" name="service_description" defaultValue={c.service_description ?? ""} /></Field>
              <Field label={`Monthly fee (${ctx.workspace.currency})`} htmlFor="monthly_fee"><Input id="monthly_fee" name="monthly_fee" type="number" step="0.01" min="0" defaultValue={c.monthly_fee_cents ? c.monthly_fee_cents / 100 : ""} /></Field>
              <Field label="Contract end date" htmlFor="contract_end_date" hint="Used by the renewal-suggestion generator."><Input id="contract_end_date" name="contract_end_date" type="date" defaultValue={c.contract_end_date ? toIsoDate(c.contract_end_date) : ""} /></Field>
              <Field label="Client logo (PNG/JPEG, < 300 KB)" htmlFor="logo"><Input id="logo" name="logo" type="file" accept="image/png,image/jpeg" /></Field>
            </div>
            {c.logo_data && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="remove_logo" /> Remove current logo <img src={c.logo_data} alt="" className="h-6" /></label>
            )}
            <fieldset className="rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-sm font-medium">Scheduled monthly wrap {!can(ctx.entitlement, "scheduled_reports") && <Badge tone="amber">Solo plan</Badge>}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Generate on day of month" htmlFor="report_day" hint="Covers the previous month. Leave empty to turn off.">
                  <Input id="report_day" name="report_day" type="number" min="1" max="28" defaultValue={c.report_day ?? ""} disabled={!can(ctx.entitlement, "scheduled_reports")} />
                </Field>
                <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" name="report_auto_send" defaultChecked={c.report_auto_send} /> Send automatically (otherwise we email you a draft to review)</label>
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="reminders_paused" defaultChecked={c.reminders_paused} /> Pause automatic payment reminders for this client</label>
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </Card>
        <div className="space-y-6">
          <Card title="Metrics">
            <ActionForm action={saveMetricConfigAction.bind(null, id)}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500"><tr><th>Label</th><th>Unit</th><th>Monthly value</th><th>Better when</th><th>Hide</th></tr></thead>
                  <tbody>
                    {orderedMetrics(cfg).map(([k, v]) => (
                      <tr key={k}>
                        <td className="py-1 pr-1"><input type="hidden" name="key" value={k} /><input name="label" defaultValue={v.label} aria-label="Label" className="w-full rounded border border-slate-300 px-2 py-1" /></td>
                        <td className="pr-1"><input name="unit" defaultValue={v.unit} aria-label="Unit" className="w-20 rounded border border-slate-300 px-2 py-1" /></td>
                        <td className="pr-1"><select name="agg" defaultValue={v.agg ?? "sum"} aria-label="Aggregation" className="rounded border border-slate-300 px-1 py-1"><option value="sum">Total</option><option value="avg">Average</option><option value="last">Latest</option></select></td>
                        <td className="pr-1"><select name="better" defaultValue={v.better ?? "up"} aria-label="Direction" className="rounded border border-slate-300 px-1 py-1"><option value="up">Higher</option><option value="down">Lower</option></select></td>
                        <td className="text-center"><input type="checkbox" name="hidden" value={k} defaultChecked={v.hidden} aria-label="Hide" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-4">
                <Input name="new_label" placeholder="Add metric…" aria-label="New metric label" />
                <Input name="new_unit" placeholder="Unit" aria-label="New metric unit" />
                <Select name="new_agg" aria-label="New metric aggregation"><option value="sum">Total</option><option value="avg">Average</option><option value="last">Latest</option></Select>
                <Select name="new_better" aria-label="New metric direction"><option value="up">Higher is better</option><option value="down">Lower is better</option></Select>
              </div>
              <SubmitButton variant="secondary">Save metrics</SubmitButton>
            </ActionForm>
          </Card>
          <Card title="Messaging consent">
            <div className="flex flex-wrap gap-2 text-sm">
              {(["email", "sms", "whatsapp"] as const).map((ch) => (
                <span key={ch}>{ch}: <Badge tone={data.consent[ch] === "unsubscribed" || data.consent[ch] === "revoked" ? "red" : data.consent[ch] ? "green" : "slate"}>{data.consent[ch] ?? (ch === "email" ? "ok (transactional)" : "no consent")}</Badge></span>
              ))}
            </div>
            <ActionForm action={recordConsentAction.bind(null, id)} className="mt-4 space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <Select name="channel" aria-label="Channel"><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option></Select>
                <Select name="action" aria-label="Consent action"><option value="granted">Consent given</option><option value="revoked">Consent withdrawn</option><option value="resubscribed">Re-subscribed (client asked)</option></Select>
              </div>
              <Textarea name="evidence" rows={2} placeholder="How was consent given? e.g. 'Checked SMS box on onboarding form, 2026-09-01'" aria-label="Evidence" />
              <SubmitButton variant="secondary">Record</SubmitButton>
            </ActionForm>
            {data.history.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-slate-500">
                {data.history.map((h) => <li key={h.id}>{new Date(h.created_at).toLocaleString()} · {h.channel} · {h.action} · {h.source}{h.evidence ? ` · ${h.evidence}` : ""}</li>)}
              </ul>
            )}
          </Card>
          <Card title="Archive or delete">
            <ActionForm action={archiveClientAction.bind(null, id)} className="mb-4">
              <input type="hidden" name="archive" value={c.archived_at ? "0" : "1"} />
              <p className="text-sm text-slate-600">{c.archived_at ? "Restore this client (counts toward your limit)." : "Archiving hides the client, stops reminders and frees a client slot. Data is kept."}</p>
              <SubmitButton variant="secondary">{c.archived_at ? "Restore client" : "Archive client"}</SubmitButton>
            </ActionForm>
            <ActionForm action={deleteClientAction.bind(null, id)}>
              <Alert tone="error">Deleting permanently removes this client's data, reports, invoices and message history.</Alert>
              <Input name="confirm" placeholder={`Type "${c.name}" to confirm`} aria-label="Confirm client name" />
              <SubmitButton variant="danger">Delete permanently</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
