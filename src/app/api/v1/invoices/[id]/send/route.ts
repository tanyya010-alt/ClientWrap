import { apiHandler } from "@/lib/api-auth";
import { assertFeature } from "@/lib/entitlements";
import { sendInvoice } from "@/lib/invoices";

export const dynamic = "force-dynamic";

/** POST /api/v1/invoices/:id/send → opens the invoice, creates the Stripe pay link and emails the client. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return apiHandler(async (ctx, q) => {
    assertFeature(ctx.entitlement, "invoices");
    if (!ctx.user.email_verified_at) return { status: 403, body: { error: "Confirm your email address first." } };
    const exists = await q.maybe("select id from invoices where id = $1", [id]);
    if (!exists) return { status: 404, body: { error: "invoice not found" } };
    const r = await sendInvoice(q, ctx.workspace, ctx.entitlement, id, ctx.user.id);
    return { status: r.outcome.status === "sent" ? 200 : 409, body: r };
  });
}
