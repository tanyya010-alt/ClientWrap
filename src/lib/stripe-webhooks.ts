import Stripe from "stripe";
import { withService, type Q } from "./db";
import { decryptOrNull } from "./crypto";
import { env } from "./env";
import { deactivatePaymentLink, markInvoicePaid } from "./invoices";
import { sendToClient } from "./messaging";
import { loadEntitlementQ } from "./entitlements";
import { formatMoney } from "./time";
import { audit } from "./audit";
import { PAID_PLANS } from "./tiers";

async function recordEvent(q: Q, event: Stripe.Event, scope: string, workspaceId: string | null): Promise<boolean> {
  const n = await q.exec(
    `insert into stripe_events (id, scope, workspace_id, type, payload) values ($1,$2,$3,$4,$5) on conflict (id) do nothing`,
    [`${scope}:${event.id}`, scope, workspaceId, event.type, JSON.stringify(event)],
  );
  if (n > 0) return true;
  const row = await q.one("select processed_at from stripe_events where id = $1", [`${scope}:${event.id}`]);
  return row.processed_at === null; // re-process only if a previous attempt failed
}

/** Invoice payment webhook for a provider's own Stripe account. */
export async function handleWorkspaceStripeWebhook(workspaceId: string, raw: string, signature: string | null): Promise<{ status: number; body: object }> {
  const ws = await withService((q) => q.maybe("select * from workspaces where id = $1", [workspaceId]));
  if (!ws) return { status: 404, body: { error: "unknown workspace" } };
  const secret = decryptOrNull(ws.stripe_webhook_secret_enc);
  if (!secret || !signature) return { status: 400, body: { error: "webhook not configured" } };
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(raw, signature, secret);
  } catch {
    return { status: 400, body: { error: "invalid signature" } };
  }
  await processWorkspaceStripeEvent(ws.id, event);
  return { status: 200, body: { received: true } };
}

export async function processWorkspaceStripeEvent(workspaceId: string, event: Stripe.Event) {
  await withService(async (q) => {
    if (!(await recordEvent(q, event, "workspace", workspaceId))) return;
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status === "paid") {
        const linkId = typeof session.payment_link === "string" ? session.payment_link : session.payment_link?.id;
        const invoice = linkId
          ? await q.maybe("select * from invoices where workspace_id = $1 and stripe_payment_link_id = $2", [workspaceId, linkId])
          : null;
        if (invoice) {
          const r = await markInvoicePaid(q, {
            invoiceId: invoice.id,
            amountCents: session.amount_total ?? undefined,
            method: "stripe",
            stripeEventId: event.id,
            paymentIntent: typeof session.payment_intent === "string" ? session.payment_intent : undefined,
            actor: "stripe",
          });
          if (r.changed) {
            const ws = await q.one("select * from workspaces where id = $1", [workspaceId]);
            await deactivatePaymentLink(ws, invoice);
            const client = await q.one("select * from clients where id = $1", [invoice.client_id]);
            const ent = await loadEntitlementQ(q, ws.owner_id);
            await sendToClient(q, {
              workspace: ws,
              client,
              ent,
              channel: "email",
              kind: "receipt",
              subject: `Payment received for invoice ${invoice.number}`,
              bodyText: `Hi ${client.contact_name || client.name},\n\nThank you! We received your payment of ${formatMoney(session.amount_total ?? invoice.total_cents, invoice.currency)} for invoice ${invoice.number}. No further reminders will be sent.\n\n${ws.name}`,
              invoiceId: invoice.id,
            });
          }
        }
      }
    }
    await q.exec("update stripe_events set processed_at = now() where id = $1", [`workspace:${event.id}`]);
  });
}

// ---------------------------------------------------------------- platform billing (our own plans)

export function platformStripe(): Stripe | null {
  return env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 }) : null;
}

export async function handleBillingWebhook(raw: string, signature: string | null): Promise<{ status: number; body: object }> {
  if (!env.STRIPE_WEBHOOK_SECRET || !signature) return { status: 400, body: { error: "not configured" } };
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(raw, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return { status: 400, body: { error: "invalid signature" } };
  }
  await processBillingEvent(event);
  return { status: 200, body: { received: true } };
}

export async function processBillingEvent(event: Stripe.Event) {
  await withService(async (q) => {
    if (!(await recordEvent(q, event, "billing", null))) return;
    if (event.type.startsWith("customer.subscription.")) {
      const sub = event.data.object as Stripe.Subscription;
      const userId = sub.metadata?.user_id;
      const plan = sub.metadata?.plan;
      if (userId && plan && PAID_PLANS.includes(plan as any)) {
        const item = sub.items?.data?.[0];
        const periodEnd = (item as any)?.current_period_end ?? (sub as any).current_period_end ?? null;
        await q.exec(
          `insert into subscriptions (user_id, stripe_customer_id, stripe_subscription_id, plan, billing_interval, status, current_period_end, cancel_at_period_end, updated_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8, now())
           on conflict (stripe_subscription_id) do update set plan = excluded.plan, billing_interval = excluded.billing_interval,
             status = excluded.status, current_period_end = excluded.current_period_end,
             cancel_at_period_end = excluded.cancel_at_period_end, updated_at = now()`,
          [
            userId,
            typeof sub.customer === "string" ? sub.customer : sub.customer.id,
            sub.id,
            plan,
            item?.price?.recurring?.interval ?? "month",
            event.type === "customer.subscription.deleted" ? "canceled" : sub.status,
            periodEnd ? new Date(periodEnd * 1000) : null,
            sub.cancel_at_period_end,
          ],
        );
        const ws = await q.maybe("select id from workspaces where owner_id = $1", [userId]);
        await audit(q, { workspaceId: ws?.id ?? null, userId, actor: "stripe", action: `subscription.${event.type.split(".").pop()}`, metadata: { plan, status: sub.status } });
      }
    }
    await q.exec("update stripe_events set processed_at = now() where id = $1", [`billing:${event.id}`]);
  });
}
