import { notFound } from "next/navigation";
import { resolveInvoiceToken, asOwner } from "@/lib/public-access";
import { PortalShell } from "@/components/portal-shell";
import { showPoweredBy } from "@/lib/messaging";
import { formatMoney, toIsoDate } from "@/lib/time";
import { ensurePaymentLink } from "@/lib/invoices";

export const dynamic = "force-dynamic";
export const metadata = { title: "Invoice", robots: { index: false } };

export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await resolveInvoiceToken(token);
  if (!ctx || ctx.invoice.status === "draft" || ctx.invoice.status === "void") notFound();
  const { invoice, workspace: ws, client, ent } = ctx;
  let payLink: string | null = invoice.stripe_payment_link_url;
  if (invoice.status === "open" && !payLink && ent.mode === "full") {
    payLink = await asOwner(ctx, (q) => ensurePaymentLink(q, ws, ent, invoice)).catch(() => null);
  }
  const items = await asOwner(ctx, (q) => q.many("select description, quantity::float8 as quantity, amount_cents from invoice_items where invoice_id = $1 order by position", [invoice.id]));
  const color = client.brand_color || ws.brand_color;
  return (
    <PortalShell brand={{ name: ws.name, color, logo: ws.logo_data }} poweredBy={showPoweredBy(ws, ent)}>
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">Invoice {invoice.number} · {client.name}</p>
        <p className="mt-1 text-3xl font-bold">{formatMoney(invoice.total_cents, invoice.currency)}</p>
        <p className="text-sm text-slate-600">Due {toIsoDate(invoice.due_date)}</p>
        <ul className="mt-4 divide-y divide-slate-100 text-sm">
          {items.map((it, i) => (
            <li key={i} className="flex justify-between py-2"><span>{it.description}{it.quantity !== 1 ? ` × ${it.quantity}` : ""}</span><span>{formatMoney(it.amount_cents, invoice.currency)}</span></li>
          ))}
        </ul>
        {invoice.status === "paid" ? (
          <p className="mt-6 rounded-lg bg-emerald-50 p-3 text-center font-medium text-emerald-800">Paid{invoice.paid_at ? ` on ${new Date(invoice.paid_at).toLocaleDateString()}` : ""}. Thank you!</p>
        ) : (
          <div className="mt-6 space-y-3">
            {payLink && (
              <a href={payLink} className="block rounded-lg px-4 py-3 text-center font-semibold text-white" style={{ background: color }}>
                Pay {formatMoney(invoice.total_cents, invoice.currency)} securely
              </a>
            )}
            {ws.payment_instructions && (
              <div className="rounded-lg bg-slate-50 p-3 text-sm">
                <p className="font-medium">{payLink ? "Or pay by bank transfer" : "How to pay"}</p>
                <p className="mt-1 whitespace-pre-line text-slate-700">{ws.payment_instructions}</p>
              </div>
            )}
            {!payLink && !ws.payment_instructions && <p className="text-sm text-slate-600">Please contact {ws.name} for payment details.</p>}
          </div>
        )}
        <a href={`/pay/${encodeURIComponent(token)}/pdf`} className="mt-4 block text-center text-sm text-slate-600 underline">Download PDF</a>
      </div>
    </PortalShell>
  );
}
