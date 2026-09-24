import { resolvePortal, asOwner } from "@/lib/public-access";
import { renderReportPdf } from "@/lib/report-service";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ token: string; period: string }> }) {
  const { token, period } = await params;
  const ctx = await resolvePortal(token, req.headers.get("host"));
  if (!ctx || ctx.ent.mode !== "full") return new Response("Not found", { status: 404 });
  const r = await asOwner(ctx, async (q) => {
    const rep = await q.maybe("select id from reports where client_id = $1 and period = $2 and status = 'sent'", [ctx.client.id, period]);
    return rep ? renderReportPdf(q, ctx.workspace, ctx.ent, rep.id) : null;
  });
  if (!r) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(r.pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${period}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
