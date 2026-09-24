import Stripe from "stripe";
import type { Q, Row } from "./db";
import { decryptOrNull, encrypt } from "./crypto";
import { env } from "./env";

/**
 * Providers connect their OWN Stripe account by pasting a restricted/secret key (bring-your-own).
 * Invoices are paid straight to the provider; ClientWrap never touches the money.
 */
export function workspaceStripe(ws: Row): Stripe | null {
  const key = decryptOrNull(ws.stripe_secret_key_enc);
  return key ? new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000 }) : null;
}

export const STRIPE_WORKSPACE_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
];

export async function connectStripe(q: Q, ws: Row, secretKey: string): Promise<{ accountName: string; webhook: boolean }> {
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(secretKey.trim())) {
    throw new Error("That doesn't look like a Stripe secret or restricted key (it should start with sk_ or rk_).");
  }
  const stripe = new Stripe(secretKey.trim(), { maxNetworkRetries: 1, timeout: 20_000 });
  let accountName = "Stripe account";
  try {
    const acct = await stripe.accounts.retrieveCurrent();
    accountName = acct.settings?.dashboard?.display_name || acct.business_profile?.name || acct.email || acct.id;
  } catch (e) {
    const err = e as Stripe.errors.StripeError;
    if (err.type === "StripeAuthenticationError") throw new Error("Stripe rejected that key. Copy it again from Stripe → Developers → API keys.");
    // Restricted keys may not read the account; fall back to a harmless call that needs Payment Links access.
    await stripe.paymentLinks.list({ limit: 1 });
  }
  // Remove a previous endpoint we created, then register the webhook for payment status sync.
  const old = workspaceStripe(ws);
  if (old && ws.stripe_webhook_endpoint_id) await old.webhookEndpoints.del(ws.stripe_webhook_endpoint_id).catch(() => {});
  let endpointId: string | null = null;
  let whSecret: string | null = null;
  if (env.APP_URL.startsWith("https://")) {
    const ep = await stripe.webhookEndpoints.create({
      url: `${env.APP_URL}/api/webhooks/stripe/${ws.id}`,
      enabled_events: STRIPE_WORKSPACE_EVENTS,
      description: "ClientWrap invoice payment sync",
    });
    endpointId = ep.id;
    whSecret = ep.secret ?? null;
  }
  await q.exec(
    `update workspaces set stripe_secret_key_enc = $2, stripe_webhook_endpoint_id = $3, stripe_webhook_secret_enc = $4,
       stripe_account_name = $5, updated_at = now() where id = $1`,
    [ws.id, encrypt(secretKey.trim()), endpointId, whSecret ? encrypt(whSecret) : null, accountName],
  );
  return { accountName, webhook: Boolean(endpointId) };
}

export async function disconnectStripe(q: Q, ws: Row) {
  const stripe = workspaceStripe(ws);
  if (stripe && ws.stripe_webhook_endpoint_id) await stripe.webhookEndpoints.del(ws.stripe_webhook_endpoint_id).catch(() => {});
  await q.exec(
    `update workspaces set stripe_secret_key_enc = null, stripe_webhook_endpoint_id = null, stripe_webhook_secret_enc = null,
       stripe_account_name = null, updated_at = now() where id = $1`,
    [ws.id],
  );
}
