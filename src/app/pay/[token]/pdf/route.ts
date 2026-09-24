import { resolveInvoiceToken, asOwner } from "@/lib/public-access";
import { renderInvoicePdf } from "@/lib/invoices";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await resolveInvoiceToken(token);
  if (!ctx || ctx.invoice.status === "draft") return new Response("Not found", { status: 404 });
  const pdf = await asOwner(ctx, (q) => renderInvoicePdf(q, ctx.workspace, ctx.ent, ctx.invoice.id));
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${ctx.invoice.number}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
