import { getAppContext, inTenant } from "@/lib/auth";
import { renderReportPdf } from "@/lib/report-service";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  if (!ctx) return json({ error: "unauthorized" }, 401);
  const r = await inTenant(ctx, async (q) => {
    const exists = await q.maybe("select id from reports where id = $1", [id]);
    return exists ? renderReportPdf(q, ctx.workspace, ctx.entitlement, id) : null;
  });
  if (!r) return json({ error: "not found" }, 404);
  return new Response(new Uint8Array(r.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${r.client.name.replace(/[^A-Za-z0-9]+/g, "-")}-${r.report.period}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
