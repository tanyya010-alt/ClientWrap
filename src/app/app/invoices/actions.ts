"use server";

import { redirect } from "next/navigation";
import { tenantAction, str, UserError } from "@/lib/actions";
import type { ActionState } from "@/lib/action-types";
import { assertFeature, assertWritable } from "@/lib/entitlements";
import { invoiceInputSchema, saveInvoice, sendInvoice, markInvoicePaid, deactivatePaymentLink } from "@/lib/invoices";
import { audit } from "@/lib/audit";

export async function saveInvoiceAction(existingId: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  let id = existingId ?? "";
  const sendNow = fd.get("intent") === "send";
  const r = await tenantAction(async (ctx, q) => {
    assertFeature(ctx.entitlement, "invoices");
    let items: unknown;
    try {
      items = JSON.parse(str(fd, "items") || "[]");
    } catch {
      throw new UserError("Line items are invalid.");
    }
    const input = invoiceInputSchema.parse({
      clientId: str(fd, "client_id"),
      dueDate: str(fd, "due_date"),
      issueDate: str(fd, "issue_date") || undefined,
      currency: str(fd, "currency"),
      notes: str(fd, "notes") || null,
      items,
    });
    const inv = await saveInvoice(q, ctx.workspace, input, existingId ?? undefined);
    id = inv.id;
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: existingId ? "invoice.updated" : "invoice.created", targetType: "invoice", targetId: inv.id });
    if (sendNow) {
      if (!ctx.user.email_verified_at) throw new UserError("Invoice saved. Confirm your email address first, then send it.");
      const res = await sendInvoice(q, ctx.workspace, ctx.entitlement, inv.id, ctx.user.id);
      if (res.outcome.status !== "sent") throw new UserError(`Invoice saved but not sent: ${res.outcome.reason}`);
    }
  }, { revalidate: ["/app/invoices", "/app"] });
  if (r?.error) return r;
  redirect(`/app/invoices/${id}${sendNow ? "?sent=1" : ""}`);
}

export async function sendInvoiceAction(id: string): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertFeature(ctx.entitlement, "invoices");
    if (!ctx.user.email_verified_at) throw new UserError("Confirm your email address first (check your inbox).");
    const res = await sendInvoice(q, ctx.workspace, ctx.entitlement, id, ctx.user.id);
    if (res.outcome.status !== "sent") throw new UserError(`Not sent: ${res.outcome.reason}`);
    return { ok: true, message: `Invoice sent.${res.linkError ? ` (Stripe pay link unavailable: ${res.linkError})` : ""}` };
  }, { revalidate: ["/app/invoices"] });
}

export async function markPaidAction(id: string): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertWritable(ctx.entitlement);
    const r = await markInvoicePaid(q, { invoiceId: id, method: "manual", actor: "user", userId: ctx.user.id });
    if (r.changed) {
      const inv = await q.one("select * from invoices where id = $1", [id]);
      await deactivatePaymentLink(ctx.workspace, inv);
    }
    return { ok: true, message: "Marked as paid. Reminders stopped." };
  }, { revalidate: ["/app/invoices", "/app"] });
}

export async function voidInvoiceAction(id: string): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertWritable(ctx.entitlement);
    const inv = await q.one("select * from invoices where id = $1", [id]);
    if (inv.status === "paid") throw new UserError("Paid invoices can't be voided.");
    await q.exec("update invoices set status = 'void', updated_at = now() where id = $1", [id]);
    await deactivatePaymentLink(ctx.workspace, inv);
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "invoice.voided", targetType: "invoice", targetId: id });
    return { ok: true, message: "Invoice voided. Reminders stopped." };
  }, { revalidate: ["/app/invoices"] });
}

export async function deleteDraftAction(id: string): Promise<ActionState> {
  const r = await tenantAction(async (ctx, q) => {
    const n = await q.exec("delete from invoices where id = $1 and status = 'draft'", [id]);
    if (!n) throw new UserError("Only drafts can be deleted; void sent invoices instead.");
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "invoice.deleted", targetType: "invoice", targetId: id });
  }, { revalidate: ["/app/invoices"] });
  if (r?.error) return r;
  redirect("/app/invoices");
}
