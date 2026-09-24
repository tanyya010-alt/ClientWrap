import { getAppContext, inTenant } from "@/lib/auth";
import { renderInvoicePdf } from "@/lib/invoices";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  if (!ctx) return json({ error: "unauthorized" }, 401);
  const r = await inTenant(ctx, async (q) => {
    const inv = await q.maybe("select number from invoices where id = $1", [id]);
    return inv ? { number: inv.number as string, pdf: await renderInvoicePdf(q, ctx.workspace, ctx.entitlement, id) } : null;
  });
  if (!r) return json({ error: "not found" }, 404);
  return new Response(new Uint8Array(r.pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${r.number}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
