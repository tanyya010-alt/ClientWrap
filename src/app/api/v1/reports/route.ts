import { z } from "zod";
import { apiHandler } from "@/lib/api-auth";
import { assertFeature } from "@/lib/entitlements";
import { generateReport } from "@/lib/report-service";

export const dynamic = "force-dynamic";

const body = z.object({ clientId: z.string().uuid(), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), regenerate: z.boolean().optional() });

/** POST /api/v1/reports  {clientId, period: "YYYY-MM", regenerate?} → generates (or refreshes) a draft wrap. */
export async function POST(req: Request) {
  const input = body.safeParse(await req.json().catch(() => null));
  return apiHandler(async (ctx, q) => {
    if (!input.success) return { status: 422, body: { error: input.error.issues[0].message } };
    assertFeature(ctx.entitlement, "monthly_reports");
    const client = await q.maybe("select * from clients where id = $1", [input.data.clientId]);
    if (!client) return { status: 404, body: { error: "client not found" } };
    const { report, aiError } = await generateReport(q, ctx.workspace, ctx.entitlement, client, input.data.period, { regenerateNarrative: input.data.regenerate });
    return { status: 201, body: { report, aiError } };
  });
}
