"use server";

import { redirect } from "next/navigation";
import { requireApp } from "@/lib/auth";
import { withService } from "@/lib/db";
import { redeemLicense } from "@/lib/appsumo";
import { str, toActionError } from "@/lib/actions";
import type { ActionState } from "@/lib/action-types";
import { rateLimit } from "@/lib/ratelimit";
import { platformStripe } from "@/lib/stripe-webhooks";
import { env } from "@/lib/env";
import { PAID_PLANS, type PlanKey } from "@/lib/tiers";

export async function applyLicenseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireApp();
  if (!(await rateLimit(`redeem:${ctx.user.id}`, 10, 3600))) return { error: "Too many attempts. Try again in an hour." };
  try {
    const r = await withService((q) => redeemLicense(q, ctx.user.id, str(fd, "license_key"), "manual"));
    return { ok: true, message: r.status === "redeemed" ? `License applied: you're on ${r.plan}.` : "License saved; it will activate within a minute." };
  } catch (e) {
    return toActionError(e);
  }
}

export async function checkoutAction(plan: PlanKey, interval: "month" | "year") {
  const ctx = await requireApp();
  const stripe = platformStripe();
  const price = env.stripePrice(plan, interval);
  if (!stripe || !price || !PAID_PLANS.includes(plan)) redirect("/app/billing?error=billing_unavailable");
  const existing = await withService((q) => q.maybe("select stripe_customer_id from subscriptions where user_id = $1 and stripe_customer_id is not null limit 1", [ctx.user.id]));
  const session = await stripe!.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: price!, quantity: 1 }],
    customer: existing?.stripe_customer_id ?? undefined,
    customer_email: existing ? undefined : ctx.user.email,
    client_reference_id: ctx.user.id,
    subscription_data: { metadata: { user_id: ctx.user.id, plan } },
    allow_promotion_codes: true,
    success_url: `${env.APP_URL}/app/billing?checkout=success`,
    cancel_url: `${env.APP_URL}/app/billing?checkout=cancel`,
  });
  redirect(session.url!);
}

export async function billingPortalAction() {
  const ctx = await requireApp();
  const stripe = platformStripe();
  const sub = await withService((q) => q.maybe("select stripe_customer_id from subscriptions where user_id = $1 and stripe_customer_id is not null order by updated_at desc limit 1", [ctx.user.id]));
  if (!stripe || !sub) redirect("/app/billing?error=billing_unavailable");
  const session = await stripe!.billingPortal.sessions.create({ customer: sub!.stripe_customer_id, return_url: `${env.APP_URL}/app/billing` });
  redirect(session.url);
}
