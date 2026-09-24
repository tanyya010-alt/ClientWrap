import { apiHandler } from "@/lib/api-auth";
import { assertFeature } from "@/lib/entitlements";
import { sendReport } from "@/lib/report-service";

export const dynamic = "force-dynamic";

/** POST /api/v1/reports/:id/send → emails the wrap to the client (PDF + portal link). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return apiHandler(async (ctx, q) => {
    assertFeature(ctx.entitlement, "monthly_reports");
    if (!ctx.user.email_verified_at) return { status: 403, body: { error: "Confirm your email address first." } };
    const exists = await q.maybe("select id from reports where id = $1", [id]);
    if (!exists) return { status: 404, body: { error: "report not found" } };
    const outcome = await sendReport(q, ctx.workspace, ctx.entitlement, id, ctx.user.id);
    return { status: outcome.status === "sent" ? 200 : 409, body: outcome };
  });
}
