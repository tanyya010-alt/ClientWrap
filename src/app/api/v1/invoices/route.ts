import { apiHandler } from "@/lib/api-auth";
import { assertFeature } from "@/lib/entitlements";
import { invoiceInputSchema, saveInvoice } from "@/lib/invoices";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** POST /api/v1/invoices {clientId, dueDate, currency, items:[{description, quantity, unitAmount}], notes?} → draft invoice. */
export async function POST(req: Request) {
  const input = invoiceInputSchema.safeParse(await req.json().catch(() => null));
  return apiHandler(async (ctx, q) => {
    if (!input.success) return { status: 422, body: { error: input.error.issues[0].message } };
    assertFeature(ctx.entitlement, "invoices");
    const inv = await saveInvoice(q, ctx.workspace, input.data);
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "invoice.created", targetType: "invoice", targetId: inv.id, metadata: { via: "api" } });
    return { status: 201, body: { invoice: inv } };
  });
}
