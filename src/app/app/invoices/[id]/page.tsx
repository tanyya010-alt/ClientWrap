import Link from "next/link";
import { notFound } from "next/navigation";
import { requireApp, inTenant } from "@/lib/auth";
import { Alert, Badge, Card, PageHeader } from "@/components/ui";
import { ActionForm, CopyButton, SubmitButton } from "@/components/forms";
import { InvoiceEditor } from "@/components/invoice-editor";
import { deleteDraftAction, markPaidAction, saveInvoiceAction, sendInvoiceAction, voidInvoiceAction } from "../actions";
import { formatMoney, toIsoDate, addDaysIso } from "@/lib/time";
import { payUrl, stepKey } from "@/lib/reminders";
import { CURRENCIES } from "@/lib/timezones";
import { can } from "@/lib/tiers";

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireApp();
  const data = await inTenant(ctx, async (q) => {
    const invoice = await q.maybe("select * from invoices where id = $1", [id]);
    if (!invoice) return null;
    const client = await q.one("select * from clients where id = $1", [invoice.client_id]);
    const items = await q.many("select description, quantity::float8 as quantity, unit_amount_cents from invoice_items where invoice_id = $1 order by position", [id]);
    const log = await q.many("select * from message_log where invoice_id = $1 order by created_at desc", [id]);
    const payments = await q.many("select * from payments where invoice_id = $1", [id]);
    const rules = await q.many("select * from reminder_rules where enabled order by offset_days, channel");
    const clients = await q.many("select id, name, monthly_fee_cents from clients where archived_at is null order by name");
    return { invoice, client, items, log, payments, rules, clients };
  });
  if (!data) notFound();
  const { invoice: inv, client } = data;
  const due = toIsoDate(inv.due_date);
  const sentSteps = new Set(data.log.filter((m) => m.kind === "reminder").map((m) => m.step_key));
  return (
    <>
      <PageHeader
        title={<span className="flex items-center gap-2">Invoice {inv.number} <Badge tone={inv.status === "paid" ? "green" : inv.status === "open" ? "blue" : "slate"}>{inv.status}</Badge></span>}
        subtitle={<><Link className="text-indigo-600" href={`/app/clients/${client.id}`}>{client.name}</Link> · {formatMoney(inv.total_cents, inv.currency)} · due {due}</>}
        actions={<a href={`/api/invoices/${id}/pdf`} className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium">Download PDF</a>}
      />
      {sp.sent && <div className="mb-4"><Alert tone="success">Invoice sent to {client.contact_email}.</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {inv.status === "draft" ? (
            <Card title="Edit draft">
              <InvoiceEditor
                action={saveInvoiceAction.bind(null, id)}
                clients={data.clients.map((c) => ({ id: c.id, name: c.name, fee: c.monthly_fee_cents }))}
                currencies={Array.from(new Set([inv.currency, ...CURRENCIES]))}
                initial={{ clientId: inv.client_id, currency: inv.currency, issueDate: toIsoDate(inv.issue_date), dueDate: due, notes: inv.notes ?? "", items: data.items.map((i) => ({ description: i.description, quantity: i.quantity, unitAmount: i.unit_amount_cents / 100 })) }}
              />
            </Card>
          ) : (
            <Card title="Line items">
              <ul className="divide-y divide-slate-100 text-sm">
                {data.items.map((i, idx) => (
                  <li key={idx} className="flex justify-between py-2"><span>{i.description} × {i.quantity}</span><span className="tabular-nums">{formatMoney(Math.round(i.unit_amount_cents * i.quantity), inv.currency)}</span></li>
                ))}
              </ul>
              <p className="mt-2 text-right font-semibold">{formatMoney(inv.total_cents, inv.currency)}</p>
            </Card>
          )}
          {inv.status === "open" && (
            <Card title="Reminder sequence">
              {!can(ctx.entitlement, "email_reminders") ? (
                <Alert>Automatic reminders are included from the Solo plan. <a className="font-semibold underline" href="/app/billing">See plans</a>.</Alert>
              ) : client.reminders_paused ? (
                <Alert tone="warning">Reminders are paused for {client.name}. <Link className="underline" href={`/app/clients/${client.id}/settings`}>Resume</Link></Alert>
              ) : null}
              <ol className="mt-3 space-y-1 text-sm">
                {data.rules.map((r) => (
                  <li key={r.id} className="flex justify-between">
                    <span>{r.offset_days < 0 ? `${-r.offset_days} days before due` : r.offset_days === 0 ? "On the due date" : `${r.offset_days} days after due`} · {r.channel}</span>
                    <span className="text-slate-500">{sentSteps.has(stepKey(r as any)) ? "handled" : addDaysIso(due, r.offset_days)}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 text-xs text-slate-500">Sent during your client's daytime ({client.timezone ?? ctx.workspace.timezone}), outside quiet hours. <Link className="underline" href="/app/settings#reminders">Edit sequence</Link></p>
            </Card>
          )}
          <Card title="Message log">
            {data.log.length === 0 ? <p className="text-sm text-slate-500">Nothing sent yet.</p> : (
              <ul className="space-y-2 text-sm">
                {data.log.map((m) => (
                  <li key={m.id}>
                    <Badge tone={m.status === "sent" ? "green" : m.status === "failed" ? "red" : "amber"}>{m.status}</Badge> <span className="text-slate-500">{m.kind}{m.step_key ? ` (${m.step_key})` : ""}</span> {m.subject ?? ""} <span className="text-xs text-slate-500">· {new Date(m.created_at).toLocaleString()}{m.skip_reason ? ` · ${m.skip_reason}` : ""}{m.error ? ` · ${m.error}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Actions">
            <div className="space-y-3">
              {inv.status !== "void" && inv.status !== "paid" && (
                <ActionForm action={sendInvoiceAction.bind(null, id)} className="space-y-2">
                  <SubmitButton className="w-full" pendingText="Sending…">{inv.status === "draft" ? "Send to client" : "Send again"}</SubmitButton>
                </ActionForm>
              )}
              {inv.status === "open" && (
                <ActionForm action={markPaidAction.bind(null, id)} confirm="Mark this invoice as paid? Reminders will stop.">
                  <SubmitButton variant="secondary" className="w-full">Mark as paid</SubmitButton>
                </ActionForm>
              )}
              {inv.status === "open" && (
                <ActionForm action={voidInvoiceAction.bind(null, id)} confirm="Void this invoice? The pay link and reminders stop.">
                  <SubmitButton variant="secondary" className="w-full">Void</SubmitButton>
                </ActionForm>
              )}
              {inv.status === "draft" && (
                <ActionForm action={deleteDraftAction.bind(null, id)} confirm="Delete this draft?">
                  <SubmitButton variant="danger" className="w-full">Delete draft</SubmitButton>
                </ActionForm>
              )}
            </div>
          </Card>
          {inv.status !== "draft" && (
            <Card title="Client pay page">
              <div className="break-all rounded bg-slate-50 p-2 font-mono text-xs">{payUrl(id)}</div>
              <div className="mt-2"><CopyButton text={payUrl(id)} /></div>
              <p className="mt-2 text-xs text-slate-500">{inv.stripe_payment_link_url ? "Stripe pay button enabled. Payments sync automatically." : ctx.workspace.stripe_secret_key_enc ? "The Stripe link is created when the client opens the page." : "Connect Stripe in Settings → Integrations to add a pay button; otherwise your payment instructions are shown."}</p>
            </Card>
          )}
          {data.payments.length > 0 && (
            <Card title="Payments">
              {data.payments.map((p) => <p key={p.id} className="text-sm">{formatMoney(p.amount_cents, p.currency)} via {p.method} on {new Date(p.paid_at).toLocaleDateString()}</p>)}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
