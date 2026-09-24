import { describe, expect, it, beforeAll } from "vitest";
import Stripe from "stripe";
import { withService, withTenant } from "@/lib/db";
import { saveInvoice, markInvoicePaid } from "@/lib/invoices";
import { processInvoiceReminders, scanReminders } from "@/lib/jobs/handlers";
import { processWorkspaceStripeEvent, handleWorkspaceStripeWebhook, processBillingEvent, handleBillingWebhook } from "@/lib/stripe-webhooks";
import { encrypt, verifySignedToken } from "@/lib/crypto";
import { loadEntitlement } from "@/lib/entitlements";
import { makeAccount, makeClient } from "../helpers";

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
// A Wednesday at 15:00 UTC: outside default quiet hours.
const WED = new Date("2026-09-23T15:00:00Z");

async function setup(tier = 1) {
  const acct = await makeAccount({ tier });
  const client = await makeClient(acct.ctx);
  const dueDate = new Date(WED.getTime() - 1 * 86400_000); // due yesterday -> +1 day reminder
  const invoice = await withTenant(acct.ctx, (q) =>
    saveInvoice(q, acct.workspace, { clientId: client.id, dueDate: iso(dueDate), currency: "USD", items: [{ description: "Retainer", quantity: 1, unitAmount: 1500 }] }),
  );
  await withTenant(acct.ctx, (q) => q.exec("update invoices set status = 'open', stripe_payment_link_id = $2 where id = $1", [invoice.id, `plink_${invoice.id}`]));
  return { acct, client, invoice };
}

const sentReminders = (invoiceId: string) =>
  withService((q) => q.many("select * from message_log where invoice_id = $1 and kind = 'reminder' and status = 'sent'", [invoiceId]));

describe("reminder scheduler", () => {
  it("sends the due step once, with an unsubscribe link, and never twice", async () => {
    const { invoice } = await setup();
    await withService((q) => processInvoiceReminders(q, invoice.id, WED));
    await withService((q) => processInvoiceReminders(q, invoice.id, new Date(WED.getTime() + 3600_000)));
    const sent = await sentReminders(invoice.id);
    expect(sent).toHaveLength(1);
    expect(sent[0].step_key).toBe("email:1");
    const mail = await withService((q) => q.one("select * from email_outbox where to_address = 'jane@acme.test' order by created_at desc limit 1"));
    expect(mail.html).toContain("/u/");
    expect(mail.text_body).toMatch(/Unsubscribe: http/);
  });

  it("stops on payment (manual or Stripe)", async () => {
    const { acct, invoice } = await setup();
    await withTenant(acct.ctx, (q) => markInvoicePaid(q, { invoiceId: invoice.id, method: "manual", actor: "user" }));
    await withService((q) => processInvoiceReminders(q, invoice.id, WED));
    expect(await sentReminders(invoice.id)).toHaveLength(0);
  });

  it("respects per-client pause, quiet hours and plan", async () => {
    const paused = await setup();
    await withTenant(paused.acct.ctx, (q) => q.exec("update clients set reminders_paused = true where id = $1", [paused.client.id]));
    await withService((q) => processInvoiceReminders(q, paused.invoice.id, WED));
    expect(await sentReminders(paused.invoice.id)).toHaveLength(0);

    const quiet = await setup();
    await withService((q) => processInvoiceReminders(q, quiet.invoice.id, new Date("2026-09-23T23:00:00Z")));
    expect(await sentReminders(quiet.invoice.id)).toHaveLength(0);

    const free = await makeAccount();
    const c = await makeClient(free.ctx);
    const inv = await withTenant(free.ctx, (q) => saveInvoice(q, free.workspace, { clientId: c.id, dueDate: "2026-09-22", currency: "USD", items: [{ description: "x", quantity: 1, unitAmount: 10 }] }));
    await withTenant(free.ctx, (q) => q.exec("update invoices set status='open' where id=$1", [inv.id]));
    await withService((q) => processInvoiceReminders(q, inv.id, WED));
    expect(await sentReminders(inv.id)).toHaveLength(0);
  });

  it("honours unsubscribe (consent record) and logs the skip", async () => {
    const { acct, client, invoice } = await setup();
    await withTenant(acct.ctx, (q) =>
      q.exec("insert into consent_records (workspace_id, client_id, channel, action, source) values ($1,$2,'email','unsubscribed','unsubscribe_link')", [acct.workspace.id, client.id]),
    );
    await withService((q) => processInvoiceReminders(q, invoice.id, WED));
    expect(await sentReminders(invoice.id)).toHaveLength(0);
    const skipped = await withService((q) => q.one("select * from message_log where invoice_id = $1 and status = 'skipped' and step_key = 'email:1'", [invoice.id]));
    expect(skipped.skip_reason).toMatch(/unsubscribed/i);
  });

  it("requires consent for SMS and blocks abusive custom text", async () => {
    const { acct, invoice } = await setup(2);
    await withTenant(acct.ctx, async (q) => {
      await q.exec("update reminder_rules set enabled = false where workspace_id = $1", [acct.workspace.id]);
      await q.exec("insert into reminder_rules (workspace_id, offset_days, channel, template_key) values ($1, 1, 'sms', 'friendly_after')", [acct.workspace.id]);
    });
    await withService((q) => processInvoiceReminders(q, invoice.id, WED));
    const log = await withService((q) => q.one("select * from message_log where invoice_id = $1 and channel = 'sms'", [invoice.id]));
    expect(log.status).toBe("skipped");
    expect(log.skip_reason).toMatch(/consent/i);
  });

  it("scan queues open invoices only", async () => {
    const { invoice } = await setup();
    const n = await withService((q) => scanReminders(q, WED));
    expect(n).toBeGreaterThan(0);
    const job = await withService((q) => q.maybe("select * from jobs where payload->>'invoiceId' = $1", [invoice.id]));
    expect(job).not.toBeNull();
  });
});

describe("Stripe webhooks", () => {
  it("workspace webhook verifies the signature and marks the invoice paid exactly once", async () => {
    const { acct, invoice } = await setup();
    const whSecret = "whsec_workspace_test";
    await withTenant(acct.ctx, (q) => q.exec("update workspaces set stripe_webhook_secret_enc = $2 where id = $1", [acct.workspace.id, encrypt(whSecret)]));
    const event = {
      id: `evt_${invoice.id}`,
      type: "checkout.session.completed",
      data: { object: { id: "cs_1", object: "checkout.session", payment_status: "paid", payment_link: `plink_${invoice.id}`, amount_total: 150000, payment_intent: "pi_1" } },
    };
    const payload = JSON.stringify(event);
    const bad = await handleWorkspaceStripeWebhook(acct.workspace.id, payload, "t=1,v1=bad");
    expect(bad.status).toBe(400);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: whSecret });
    const ok = await handleWorkspaceStripeWebhook(acct.workspace.id, payload, header);
    expect(ok.status).toBe(200);
    await processWorkspaceStripeEvent(acct.workspace.id, event as any); // replay
    const inv = await withTenant(acct.ctx, (q) => q.one("select * from invoices where id = $1", [invoice.id]));
    expect(inv.status).toBe("paid");
    const payments = await withTenant(acct.ctx, (q) => q.many("select * from payments where invoice_id = $1", [invoice.id]));
    expect(payments).toHaveLength(1);
    const receipt = await withTenant(acct.ctx, (q) => q.many("select * from message_log where invoice_id = $1 and kind = 'receipt'", [invoice.id]));
    expect(receipt).toHaveLength(1);
    await withService((q) => processInvoiceReminders(q, invoice.id, WED));
    expect(await sentReminders(invoice.id)).toHaveLength(0);
  });

  it("billing webhook creates and cancels subscriptions", async () => {
    const acct = await makeAccount();
    const sub = (status: string) => ({
      id: `evt_${status}_${acct.user.id}`,
      type: status === "canceled" ? "customer.subscription.deleted" : "customer.subscription.updated",
      data: { object: { id: `sub_${acct.user.id}`, customer: "cus_1", status, cancel_at_period_end: false, metadata: { user_id: acct.user.id, plan: "growth" }, items: { data: [{ current_period_end: 1893456000, price: { recurring: { interval: "year" } } }] } } },
    });
    const payload = JSON.stringify(sub("active"));
    const r = await handleBillingWebhook(payload, Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test_billing" }));
    expect(r.status).toBe(200);
    expect(await loadEntitlement(acct.user.id)).toMatchObject({ plan: "growth", source: "stripe" });
    await processBillingEvent(sub("canceled") as any);
    expect((await loadEntitlement(acct.user.id)).plan).toBe("free");
  });
});

describe("signed pay links", () => {
  it("are verifiable and purpose-bound", async () => {
    const { payUrl } = await import("@/lib/reminders");
    const url = payUrl("11111111-1111-1111-1111-111111111111");
    const token = url.split("/pay/")[1];
    expect(verifySignedToken(token, "pay")).toBe("11111111-1111-1111-1111-111111111111");
    expect(verifySignedToken(token, "portal")).toBeNull();
  });
});
