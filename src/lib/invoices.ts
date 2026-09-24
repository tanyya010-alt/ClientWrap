import type { Q, Row } from "./db";
import { z } from "zod";
import { workspaceStripe } from "./stripe-connect";
import { can, type Entitlement } from "./tiers";
import { invoicePdf } from "./pdf";
import { payUrl } from "./reminders";
import { sendToClient, showPoweredBy } from "./messaging";
import { formatMoney, toIsoDate } from "./time";
import { audit } from "./audit";

export const invoiceInputSchema = z.object({
  clientId: z.string().uuid(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a due date"),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code"),
  notes: z.string().max(2000).optional().nullable(),
  items: z
    .array(
      z.object({
        description: z.string().trim().min(1, "Each line needs a description").max(300),
        quantity: z.number().positive("Quantity must be positive").max(100000),
        unitAmount: z.number().min(0, "Price can't be negative").max(10_000_000),
      }),
    )
    .min(1, "Add at least one line item")
    .max(50),
});
export type InvoiceInput = z.infer<typeof invoiceInputSchema>;

export async function nextInvoiceNumber(q: Q, workspaceId: string): Promise<string> {
  const row = await q.one<{ n: number }>(
    `select coalesce(max(nullif(regexp_replace(number, '\\D', '', 'g'), '')::int), 0) + 1 as n from invoices where workspace_id = $1`,
    [workspaceId],
  );
  return `INV-${String(row.n).padStart(4, "0")}`;
}

export async function saveInvoice(q: Q, ws: Row, input: InvoiceInput, existingId?: string): Promise<Row> {
  const items = input.items.map((it, i) => {
    const unit = Math.round(it.unitAmount * 100);
    return { ...it, unit, amount: Math.round(unit * it.quantity), position: i };
  });
  const total = items.reduce((s, i) => s + i.amount, 0);
  let invoice: Row;
  if (existingId) {
    const cur = await q.one("select * from invoices where id = $1", [existingId]);
    if (cur.status !== "draft") throw new Error("Only draft invoices can be edited. Void it and create a new one instead.");
    invoice = await q.one(
      `update invoices set client_id=$2, due_date=$3, issue_date=coalesce($4, issue_date), currency=$5, notes=$6, total_cents=$7, updated_at=now()
       where id=$1 returning *`,
      [existingId, input.clientId, input.dueDate, input.issueDate ?? null, input.currency, input.notes ?? null, total],
    );
    await q.exec("delete from invoice_items where invoice_id = $1", [existingId]);
  } else {
    const number = await nextInvoiceNumber(q, ws.id);
    invoice = await q.one(
      `insert into invoices (workspace_id, client_id, number, currency, issue_date, due_date, notes, total_cents)
       values ($1,$2,$3,$4,coalesce($5::date, current_date),$6,$7,$8) returning *`,
      [ws.id, input.clientId, number, input.currency, input.issueDate ?? null, input.dueDate, input.notes ?? null, total],
    );
  }
  for (const it of items) {
    await q.exec(
      `insert into invoice_items (workspace_id, invoice_id, description, quantity, unit_amount_cents, amount_cents, position)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [ws.id, invoice.id, it.description, it.quantity, it.unit, it.amount, it.position],
    );
  }
  return invoice;
}

/** Creates a single-use Stripe Payment Link on the provider's own Stripe account. */
export async function ensurePaymentLink(q: Q, ws: Row, ent: Entitlement, invoice: Row): Promise<string | null> {
  if (invoice.stripe_payment_link_url) return invoice.stripe_payment_link_url;
  if (!can(ent, "stripe_pay_links")) return null;
  const stripe = workspaceStripe(ws);
  if (!stripe || invoice.total_cents <= 0) return null;
  const client = await q.one("select name from clients where id = $1", [invoice.client_id]);
  const price = await stripe.prices.create({
    currency: invoice.currency.toLowerCase(),
    unit_amount: invoice.total_cents,
    product_data: { name: `Invoice ${invoice.number} — ${client.name}`.slice(0, 250) },
  });
  const link = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: { clientwrap_invoice_id: invoice.id, clientwrap_workspace_id: ws.id },
    payment_intent_data: { metadata: { clientwrap_invoice_id: invoice.id, clientwrap_workspace_id: ws.id } },
    restrictions: { completed_sessions: { limit: 1 } },
    after_completion: { type: "hosted_confirmation", hosted_confirmation: { custom_message: "Thank you! Your payment was received." } },
  });
  await q.exec("update invoices set stripe_payment_link_id = $2, stripe_payment_link_url = $3 where id = $1", [
    invoice.id,
    link.id,
    link.url,
  ]);
  return link.url;
}

export async function loadInvoiceBundle(q: Q, invoiceId: string) {
  const invoice = await q.one("select * from invoices where id = $1", [invoiceId]);
  const items = await q.many(
    "select description, quantity::float8 as quantity, unit_amount_cents, amount_cents from invoice_items where invoice_id = $1 order by position",
    [invoiceId],
  );
  const client = await q.one("select * from clients where id = $1", [invoice.client_id]);
  return { invoice, items, client };
}

export async function renderInvoicePdf(q: Q, ws: Row, ent: Entitlement, invoiceId: string): Promise<Buffer> {
  const { invoice, items, client } = await loadInvoiceBundle(q, invoiceId);
  return invoicePdf({
    brand: { name: ws.name, color: client.brand_color || ws.brand_color, logo: ws.logo_data },
    invoice: { ...invoice, issue_date: toIsoDate(invoice.issue_date), due_date: toIsoDate(invoice.due_date) } as any,
    items: items as any,
    client: client as any,
    payUrl: invoice.status === "open" ? payUrl(invoice.id) : null,
    paymentInstructions: ws.payment_instructions,
    poweredBy: showPoweredBy(ws, ent),
  });
}

export async function sendInvoice(q: Q, ws: Row, ent: Entitlement, invoiceId: string, userId: string | null) {
  const { invoice, client } = await loadInvoiceBundle(q, invoiceId);
  if (invoice.status === "void" || invoice.status === "paid") throw new Error(`This invoice is ${invoice.status}.`);
  if (invoice.total_cents <= 0) throw new Error("The invoice total must be more than zero.");
  if (invoice.status === "draft") await q.exec("update invoices set status = 'open', updated_at = now() where id = $1", [invoiceId]);
  const fresh = await q.one("select * from invoices where id = $1", [invoiceId]);
  let linkError: string | null = null;
  try {
    await ensurePaymentLink(q, ws, ent, fresh);
  } catch (e) {
    linkError = (e as Error).message;
  }
  const pdf = await renderInvoicePdf(q, ws, ent, invoiceId);
  const due = toIsoDate(invoice.due_date);
  const outcome = await sendToClient(q, {
    workspace: ws,
    client,
    ent,
    channel: "email",
    kind: "invoice",
    subject: `Invoice ${invoice.number} from ${ws.name}`,
    bodyText: `Hi ${client.contact_name || client.name},\n\nPlease find invoice ${invoice.number} for ${formatMoney(invoice.total_cents, invoice.currency)} attached, due on ${due}.${ws.payment_instructions ? `\n\n${ws.payment_instructions}` : ""}\n\nThank you,\n${ws.name}`,
    cta: { url: payUrl(invoiceId), label: "View & pay invoice" },
    invoiceId,
    attachments: [{ filename: `${invoice.number}.pdf`, content: pdf }],
  });
  if (outcome.status === "sent") await q.exec("update invoices set sent_at = now() where id = $1", [invoiceId]);
  await audit(q, { workspaceId: ws.id, userId, action: "invoice.sent", targetType: "invoice", targetId: invoiceId, metadata: { outcome: outcome.status } });
  return { outcome, linkError };
}

/**
 * Marks an invoice paid exactly once (idempotent on stripe event id / invoice state), which also stops
 * every future reminder because the scheduler only considers open invoices.
 */
export async function markInvoicePaid(
  q: Q,
  input: { invoiceId: string; amountCents?: number; method: "stripe" | "manual"; stripeEventId?: string; paymentIntent?: string; actor: "user" | "stripe"; userId?: string | null },
): Promise<{ changed: boolean }> {
  const invoice = await q.maybe("select * from invoices where id = $1 for update", [input.invoiceId]);
  if (!invoice) return { changed: false };
  if (input.stripeEventId) {
    const dup = await q.maybe("select 1 from payments where stripe_event_id = $1", [input.stripeEventId]);
    if (dup) return { changed: false };
  }
  if (invoice.status === "paid") return { changed: false };
  await q.exec(
    `insert into payments (workspace_id, invoice_id, amount_cents, currency, method, stripe_event_id, stripe_payment_intent)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [invoice.workspace_id, invoice.id, input.amountCents ?? invoice.total_cents, invoice.currency, input.method, input.stripeEventId ?? null, input.paymentIntent ?? null],
  );
  await q.exec("update invoices set status = 'paid', paid_at = now(), updated_at = now() where id = $1", [invoice.id]);
  await audit(q, {
    workspaceId: invoice.workspace_id,
    userId: input.userId ?? null,
    actor: input.actor,
    action: "invoice.paid",
    targetType: "invoice",
    targetId: invoice.id,
    metadata: { method: input.method },
  });
  return { changed: true };
}

export async function deactivatePaymentLink(ws: Row, invoice: Row) {
  const stripe = workspaceStripe(ws);
  if (stripe && invoice.stripe_payment_link_id) {
    await stripe.paymentLinks.update(invoice.stripe_payment_link_id, { active: false }).catch(() => {});
  }
}
