"use server";

import { redirect } from "next/navigation";
import { tenantAction, str, optStr, UserError } from "@/lib/actions";
import type { ActionState } from "@/lib/action-types";
import { assertFeature, assertWritable } from "@/lib/entitlements";
import { audit } from "@/lib/audit";
import { encrypt } from "@/lib/crypto";
import { fileToDataUrl } from "@/lib/clients";
import { isValidTimeZone } from "@/lib/time";
import { testAIKey, AI_MODELS } from "@/lib/ai";
import { connectStripe, disconnectStripe } from "@/lib/stripe-connect";
import { checkTone } from "@/lib/tone";
import { TEMPLATES } from "@/lib/reminders";
import { normalizeDomain, newDomainToken, checkCustomDomain, attachDomainToHost, detachDomainFromHost, createSenderDomain, verifySenderDomain } from "@/lib/domains";
import { authenticate, destroySession, validatePassword } from "@/lib/auth";
import { hashPassword } from "@/lib/crypto";
import { withService } from "@/lib/db";
import { deleteAccount } from "@/lib/export";
import { SERVICE_TEMPLATES } from "@/lib/templates";
import { env } from "@/lib/env";

const hex = /^#[0-9a-fA-F]{6}$/;
const R = { revalidate: ["/app/settings"] };

export async function saveWorkspaceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertWritable(ctx.entitlement);
    const name = str(fd, "name");
    if (!name) throw new UserError("Business name is required.");
    const tz = str(fd, "timezone");
    if (!isValidTimeZone(tz)) throw new UserError("Unknown timezone.");
    const currency = str(fd, "currency");
    if (!/^[A-Z]{3}$/.test(currency)) throw new UserError("Use a 3-letter currency code.");
    const replyTo = optStr(fd, "reply_to_email");
    if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) throw new UserError("Reply-to must be a valid email.");
    const st = str(fd, "service_type");
    await q.exec(
      `update workspaces set name=$2, timezone=$3, currency=$4, reply_to_email=$5, payment_instructions=$6, service_type=$7, updated_at=now() where id=$1`,
      [ctx.workspace.id, name, tz, currency, replyTo, optStr(fd, "payment_instructions"), SERVICE_TEMPLATES.some((t) => t.key === st) ? st : "general"],
    );
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "workspace.updated" });
    return { ok: true, message: "Saved." };
  }, R);
}

export async function saveBrandingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertWritable(ctx.entitlement);
    const brand = str(fd, "brand_color");
    const accent = str(fd, "accent_color") || brand;
    if (!hex.test(brand) || !hex.test(accent)) throw new UserError("Colors must be hex values like #4f46e5.");
    const logo = await fileToDataUrl(fd.get("logo") as File | null);
    await q.exec(
      `update workspaces set brand_color=$2, accent_color=$3, logo_data = case when $4::text is not null then $4 when $5 then null else logo_data end, updated_at=now() where id=$1`,
      [ctx.workspace.id, brand, accent, logo, fd.get("remove_logo") === "on"],
    );
    return { ok: true, message: "Branding saved. Your client pages, emails and PDFs use it now." };
  }, R);
}

export async function saveQuietHoursAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    const start = Number(str(fd, "quiet_hours_start"));
    const end = Number(str(fd, "quiet_hours_end"));
    if (![start, end].every((n) => Number.isInteger(n) && n >= 0 && n <= 23)) throw new UserError("Hours must be 0–23.");
    await q.exec("update workspaces set quiet_hours_start=$2, quiet_hours_end=$3, skip_weekends=$4 where id=$1", [ctx.workspace.id, start, end, fd.get("skip_weekends") === "on"]);
    return { ok: true, message: "Quiet hours saved." };
  }, R);
}

export async function saveRuleAction(ruleId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertWritable(ctx.entitlement);
    const template = str(fd, "template_key");
    if (!(template in TEMPLATES)) throw new UserError("Unknown template.");
    const custom = optStr(fd, "custom_message");
    if (custom) {
      const tone = checkTone(custom, { maxLength: 1200 });
      if (!tone.ok) throw new UserError(`This message can't be used: ${tone.issues.join(" ")}`);
    }
    const sid = optStr(fd, "whatsapp_content_sid");
    if (sid && !/^HX[0-9a-f]{32}$/i.test(sid)) throw new UserError("WhatsApp template SID should look like HX followed by 32 characters (from Twilio Content Template Builder, approved by WhatsApp).");
    await q.exec("update reminder_rules set enabled=$2, template_key=$3, custom_message=$4, whatsapp_content_sid=$5 where id=$1", [ruleId, fd.get("enabled") === "on", template, custom, sid]);
    return { ok: true, message: "Saved." };
  }, R);
}

export async function addRuleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertFeature(ctx.entitlement, "email_reminders");
    const offset = Number(str(fd, "offset_days"));
    const channel = str(fd, "channel");
    if (!Number.isInteger(offset) || offset < -30 || offset > 90) throw new UserError("Offset must be between -30 and 90 days.");
    if (!["email", "sms", "whatsapp"].includes(channel)) throw new UserError("Unknown channel.");
    if (channel !== "email") assertFeature(ctx.entitlement, "sms_whatsapp");
    await q.exec(
      "insert into reminder_rules (workspace_id, offset_days, channel, template_key) values ($1,$2,$3,$4) on conflict do nothing",
      [ctx.workspace.id, offset, channel, offset < 0 ? "friendly_before" : offset === 0 ? "friendly_due" : offset < 7 ? "friendly_after" : offset < 30 ? "firm_after" : "final_after"],
    );
    return { ok: true, message: "Step added." };
  }, R);
}

export async function deleteRuleAction(ruleId: string) {
  await tenantAction(async (_ctx, q) => {
    await q.exec("delete from reminder_rules where id = $1", [ruleId]);
  }, R);
}

export async function saveAiAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    const provider = str(fd, "ai_provider");
    if (provider === "") {
      await q.exec("update workspaces set ai_provider=null, ai_api_key_enc=null, ai_model=null where id=$1", [ctx.workspace.id]);
      await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "integration.ai_removed" });
      return { ok: true, message: "AI key removed. Built-in summaries will be used." };
    }
    if (provider !== "anthropic" && provider !== "openai") throw new UserError("Choose a provider.");
    const model = str(fd, "ai_model");
    if (!AI_MODELS[provider].some((m) => m.id === model)) throw new UserError("Choose a model.");
    const key = str(fd, "ai_api_key");
    if (!key && ctx.workspace.ai_provider === provider && ctx.workspace.ai_api_key_enc) {
      await q.exec("update workspaces set ai_model=$2 where id=$1", [ctx.workspace.id, model]);
      return { ok: true, message: "Model updated." };
    }
    if (!key) throw new UserError("Paste your API key.");
    const err = await testAIKey(provider, key, model);
    if (err) throw new UserError(`Key test failed: ${err}`);
    await q.exec("update workspaces set ai_provider=$2, ai_api_key_enc=$3, ai_model=$4 where id=$1", [ctx.workspace.id, provider, encrypt(key), model]);
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "integration.ai_connected", metadata: { provider, model } });
    return { ok: true, message: "Key verified and saved (encrypted)." };
  }, R);
}

export async function saveStripeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertFeature(ctx.entitlement, "stripe_pay_links");
    const key = str(fd, "stripe_key");
    if (!key) throw new UserError("Paste a Stripe restricted key.");
    const r = await connectStripe(q, ctx.workspace, key);
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "integration.stripe_connected", metadata: { account: r.accountName } });
    return { ok: true, message: `Connected to ${r.accountName}.${r.webhook ? " Payment status syncs automatically." : " Payment status syncs hourly (webhooks need an https APP_URL)."}` };
  }, R);
}

export async function disconnectStripeAction(): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    await disconnectStripe(q, ctx.workspace);
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "integration.stripe_disconnected" });
    return { ok: true, message: "Stripe disconnected." };
  }, R);
}

export async function saveTwilioAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertFeature(ctx.entitlement, "sms_whatsapp");
    if (!env.FEATURE_SMS_WHATSAPP) throw new UserError("SMS/WhatsApp is not enabled on this server yet.");
    const sid = str(fd, "twilio_account_sid");
    const token = str(fd, "twilio_auth_token");
    if (!/^AC[0-9a-f]{32}$/i.test(sid)) throw new UserError("Account SID should start with AC.");
    const sms = optStr(fd, "twilio_from_sms");
    const wa = optStr(fd, "twilio_from_whatsapp");
    for (const n of [sms, wa]) if (n && !/^\+[1-9]\d{6,14}$/.test(n)) throw new UserError("Phone numbers must be in E.164 format, e.g. +14155550100.");
    if (token) {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, { headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` } });
      if (!res.ok) throw new UserError("Twilio rejected those credentials.");
    } else if (!ctx.workspace.twilio_auth_token_enc) throw new UserError("Paste your Auth Token.");
    await q.exec(
      "update workspaces set twilio_account_sid=$2, twilio_auth_token_enc=coalesce($3, twilio_auth_token_enc), twilio_from_sms=$4, twilio_from_whatsapp=$5 where id=$1",
      [ctx.workspace.id, sid, token ? encrypt(token) : null, sms, wa],
    );
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "integration.twilio_connected" });
    return { ok: true, message: "Twilio connected." };
  }, R);
}

export async function saveWhiteLabelAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertFeature(ctx.entitlement, "white_label");
    await q.exec("update workspaces set remove_branding=$2 where id=$1", [ctx.workspace.id, fd.get("remove_branding") === "on"]);
    return { ok: true, message: "Saved." };
  }, R);
}

export async function setCustomDomainAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertFeature(ctx.entitlement, "custom_domain");
    const raw = str(fd, "custom_domain");
    if (!raw) {
      if (ctx.workspace.custom_domain) await detachDomainFromHost(ctx.workspace.custom_domain);
      await q.exec("update workspaces set custom_domain=null, custom_domain_token=null, custom_domain_verified_at=null where id=$1", [ctx.workspace.id]);
      return { ok: true, message: "Custom domain removed." };
    }
    const domain = normalizeDomain(raw);
    if (!domain) throw new UserError("Enter a domain like results.youragency.com.");
    const taken = await withService((s) => s.maybe("select 1 from workspaces where custom_domain = $1 and id <> $2", [domain, ctx.workspace.id]));
    if (taken) throw new UserError("That domain is already used by another account.");
    await q.exec("update workspaces set custom_domain=$2, custom_domain_token=$3, custom_domain_verified_at=null where id=$1", [ctx.workspace.id, domain, newDomainToken()]);
    return { ok: true, message: "Now add the two DNS records shown below, then click Verify." };
  }, R);
}

export async function verifyCustomDomainAction(): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertFeature(ctx.entitlement, "custom_domain");
    const ws = ctx.workspace;
    if (!ws.custom_domain || !ws.custom_domain_token) throw new UserError("Set a domain first.");
    const r = await checkCustomDomain(ws.custom_domain, ws.custom_domain_token);
    if (!r.ok) throw new UserError(`${r.detail} DNS changes can take up to an hour.`);
    const hostErr = await attachDomainToHost(ws.custom_domain);
    if (hostErr) throw new UserError(`DNS verified, but the domain couldn't be activated: ${hostErr}`);
    await q.exec("update workspaces set custom_domain_verified_at = now() where id = $1", [ws.id]);
    await audit(q, { workspaceId: ws.id, userId: ctx.user.id, action: "white_label.domain_verified", metadata: { domain: ws.custom_domain } });
    return { ok: true, message: "Domain verified. Client links now use it." };
  }, R);
}

export async function setSenderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertFeature(ctx.entitlement, "custom_email_sender");
    const address = str(fd, "email_from_address").toLowerCase();
    const name = str(fd, "email_from_name");
    if (!address) {
      await q.exec("update workspaces set email_from_address=null, email_from_name=null, email_domain_id=null, email_domain_records=null, email_domain_verified_at=null where id=$1", [ctx.workspace.id]);
      return { ok: true, message: "Custom sender removed." };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new UserError("Enter a valid email address.");
    const domain = address.split("@")[1];
    const sameDomain = ctx.workspace.email_from_address?.split("@")[1] === domain && ctx.workspace.email_domain_id;
    if (sameDomain) {
      await q.exec("update workspaces set email_from_address=$2, email_from_name=$3 where id=$1", [ctx.workspace.id, address, name || null]);
      return { ok: true, message: "Sender updated." };
    }
    const d = await createSenderDomain(domain);
    await q.exec(
      "update workspaces set email_from_address=$2, email_from_name=$3, email_domain_id=$4, email_domain_records=$5, email_domain_verified_at=null where id=$1",
      [ctx.workspace.id, address, name || null, d.id, JSON.stringify(d.records)],
    );
    return { ok: true, message: "Add the DNS records below, then click Verify." };
  }, R);
}

export async function verifySenderAction(): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertFeature(ctx.entitlement, "custom_email_sender");
    if (!ctx.workspace.email_domain_id) throw new UserError("Set a sender address first.");
    const ok = await verifySenderDomain(ctx.workspace.email_domain_id);
    if (!ok) throw new UserError("Not verified yet. DNS changes can take up to an hour; try again later.");
    await q.exec("update workspaces set email_domain_verified_at = now() where id = $1", [ctx.workspace.id]);
    return { ok: true, message: "Sender verified. Client emails now come from your address." };
  }, R);
}

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    const current = str(fd, "current_password");
    const next = str(fd, "new_password");
    const hasPw = await withService((s) => s.one("select password_hash is not null as has from users where id = $1", [ctx.user.id]));
    if (hasPw.has && !(await authenticate(ctx.user.email, current))) throw new UserError("Current password is incorrect.");
    const err = validatePassword(next);
    if (err) throw new UserError(err);
    await q.exec("update users set password_hash = $2, updated_at = now() where id = $1", [ctx.user.id, await hashPassword(next)]);
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "account.password_changed" });
    return { ok: true, message: "Password updated." };
  });
}

export async function deleteAccountAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction(async (ctx) => {
    if (str(fd, "confirm").toLowerCase() !== ctx.user.email.toLowerCase()) throw new UserError("Type your email address exactly to confirm.");
    await deleteAccount(ctx.user.id);
  });
  if (r?.error) return r;
  await destroySession();
  redirect("/?deleted=1");
}
