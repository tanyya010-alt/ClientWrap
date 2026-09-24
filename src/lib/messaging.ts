import type { Q, Row } from "./db";
import { env } from "./env";
import { button, emailLayout, escapeHtml, sendEmail } from "./email";
import { signedToken, decryptOrNull } from "./crypto";
import { can, type Entitlement } from "./tiers";
import { consumeUsage } from "./entitlements";
import { checkTone } from "./tone";

export type Channel = "email" | "sms" | "whatsapp";
export type MessageKind = "reminder" | "report" | "invoice" | "referral" | "case_study_approval" | "receipt" | "test";

export function unsubscribeUrl(clientId: string, channel: Channel): string {
  return `${env.APP_URL}/u/${signedToken(`${clientId}:${channel}`, "unsub")}`;
}

/** RFC 8058 one-click endpoint used in the List-Unsubscribe header. */
export function oneClickUnsubscribeUrl(clientId: string, channel: Channel): string {
  return `${env.APP_URL}/api/unsubscribe/${signedToken(`${clientId}:${channel}`, "unsub")}`;
}

/** Latest consent state per channel for a client. */
export async function consentState(q: Q, clientId: string): Promise<Record<Channel, string | null>> {
  const rows = await q.many<{ channel: Channel; action: string }>(
    `select distinct on (channel) channel, action from consent_records where client_id = $1 order by channel, created_at desc`,
    [clientId],
  );
  const out: Record<Channel, string | null> = { email: null, sms: null, whatsapp: null };
  for (const r of rows) out[r.channel] = r.action;
  return out;
}

export function canMessage(channel: Channel, consent: string | null): { ok: boolean; reason?: string } {
  if (channel === "email") {
    return consent === "unsubscribed" ? { ok: false, reason: "Client unsubscribed from emails" } : { ok: true };
  }
  // SMS/WhatsApp are opt-in only: we need an explicit consent record.
  if (consent === "granted" || consent === "resubscribed") return { ok: true };
  return { ok: false, reason: `No ${channel === "sms" ? "SMS" : "WhatsApp"} consent on record` };
}

export function workspaceSender(ws: Row, ent: Entitlement): { from: string; replyTo?: string } {
  const platformAddress = (env.EMAIL_FROM.match(/<([^>]+)>/)?.[1] ?? env.EMAIL_FROM).trim();
  if (can(ent, "custom_email_sender") && ws.email_from_address && ws.email_domain_verified_at) {
    return { from: `${ws.email_from_name || ws.name} <${ws.email_from_address}>`, replyTo: ws.reply_to_email ?? undefined };
  }
  const name = String(ws.name).replace(/[<>"]/g, "");
  return { from: `${name} via ClientWrap <${platformAddress}>`, replyTo: ws.reply_to_email ?? undefined };
}

export function showPoweredBy(ws: Row, ent: Entitlement): boolean {
  return !(can(ent, "white_label") && ws.remove_branding);
}

export interface SendToClientInput {
  workspace: Row;
  client: Row;
  ent: Entitlement;
  channel: Channel;
  kind: MessageKind;
  subject: string;
  bodyText: string;
  cta?: { url: string; label: string };
  invoiceId?: string | null;
  reportId?: string | null;
  stepKey?: string | null;
  attachments?: { filename: string; content: Buffer }[];
  whatsappContentSid?: string | null;
  whatsappVariables?: Record<string, string>;
  /** Override the recipient (e.g. test sends to the provider). */
  to?: string;
}

export interface SendOutcome {
  status: "sent" | "failed" | "skipped";
  reason?: string;
  messageId?: string;
}

async function log(q: Q, i: SendToClientInput, recipient: string | null, outcome: SendOutcome & { providerId?: string; error?: string }) {
  const row = await q.maybe<{ id: string }>(
    `insert into message_log (workspace_id, client_id, invoice_id, report_id, kind, channel, step_key, recipient, subject, body, status, skip_reason, provider_id, error)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     on conflict do nothing returning id`,
    [i.workspace.id, i.client.id, i.invoiceId ?? null, i.reportId ?? null, i.kind, i.channel, i.stepKey ?? null, recipient,
      i.subject, i.bodyText, outcome.status, outcome.status === "skipped" ? outcome.reason ?? null : null,
      outcome.providerId ?? null, outcome.error ?? null],
  );
  return row?.id;
}

/** Sends one message to a client and records it in message_log. Never throws for delivery problems. */
export async function sendToClient(q: Q, i: SendToClientInput): Promise<SendOutcome> {
  const recipient = i.to ?? (i.channel === "email" ? i.client.contact_email : i.client.contact_phone) ?? null;
  const skip = async (reason: string): Promise<SendOutcome> => {
    await log(q, i, recipient, { status: "skipped", reason });
    return { status: "skipped", reason };
  };
  if (!recipient) return skip(i.channel === "email" ? "Client has no contact email" : "Client has no phone number");
  if (i.client.is_demo && !i.to) return skip("Demo client: messages are never sent to demo clients (use “send a test to me”)");

  if (i.kind !== "receipt" && !i.to) {
    const consent = await consentState(q, i.client.id);
    const c = canMessage(i.channel, consent[i.channel]);
    if (!c.ok) return skip(c.reason!);
  }
  if (["reminder", "referral"].includes(i.kind)) {
    const tone = checkTone(i.bodyText, { maxLength: 2000 });
    if (!tone.ok) return skip(`Blocked by tone guardrails: ${tone.issues.join(" ")}`);
  }

  if (i.channel !== "email") {
    if (!env.FEATURE_SMS_WHATSAPP) return skip("SMS/WhatsApp is disabled on this server");
    if (!can(i.ent, "sms_whatsapp")) return skip("SMS/WhatsApp needs the Growth plan");
    const sid = i.workspace.twilio_account_sid;
    const token = decryptOrNull(i.workspace.twilio_auth_token_enc);
    const from = i.channel === "sms" ? i.workspace.twilio_from_sms : i.workspace.twilio_from_whatsapp;
    if (!sid || !token || !from) return skip("Twilio is not connected");
    if (i.channel === "whatsapp" && !i.whatsappContentSid) return skip("No approved WhatsApp template assigned to this step");
    try {
      await consumeUsage(q, i.workspace.id, i.ent, "sms");
    } catch (e) {
      return skip((e as Error).message);
    }
    const form = new URLSearchParams();
    form.set("To", i.channel === "whatsapp" ? `whatsapp:${recipient}` : recipient);
    form.set("From", i.channel === "whatsapp" ? `whatsapp:${from}` : from);
    if (i.channel === "whatsapp") {
      form.set("ContentSid", i.whatsappContentSid!);
      form.set("ContentVariables", JSON.stringify(i.whatsappVariables ?? {}));
    } else {
      const link = i.cta ? `\n${i.cta.url}` : "";
      form.set("Body", `${i.bodyText}${link}\nReply STOP to opt out.`);
    }
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
      });
      const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
      if (!res.ok) {
        await log(q, i, recipient, { status: "failed", error: body.message ?? `HTTP ${res.status}` });
        return { status: "failed", reason: body.message };
      }
      const id = await log(q, i, recipient, { status: "sent", providerId: body.sid });
      return { status: "sent", messageId: id };
    } catch (e) {
      await log(q, i, recipient, { status: "failed", error: (e as Error).message });
      return { status: "failed", reason: (e as Error).message };
    }
  }

  // Email
  try {
    await consumeUsage(q, i.workspace.id, i.ent, "emails");
  } catch (e) {
    return skip((e as Error).message);
  }
  const brandColor = i.client.brand_color || i.workspace.brand_color;
  const unsub = unsubscribeUrl(i.client.id, "email");
  const paragraphs = i.bodyText
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const html = emailLayout({
    title: i.subject,
    bodyHtml: paragraphs + (i.cta ? button(i.cta.url, i.cta.label, brandColor) : ""),
    brandColor,
    brandName: i.workspace.name,
    showPoweredBy: showPoweredBy(i.workspace, i.ent),
    footerHtml:
      i.kind === "receipt"
        ? ""
        : `You receive these emails because you work with ${escapeHtml(i.workspace.name)}. <a href="${unsub}" style="color:#666">Unsubscribe</a>`,
  });
  const text = `${i.bodyText}${i.cta ? `\n\n${i.cta.label}: ${i.cta.url}` : ""}${i.kind === "receipt" ? "" : `\n\nUnsubscribe: ${unsub}`}`;
  const sender = workspaceSender(i.workspace, i.ent);
  const res = await sendEmail({
    to: recipient,
    subject: i.subject,
    html,
    text,
    from: sender.from,
    replyTo: sender.replyTo,
    headers:
      i.kind === "receipt"
        ? undefined
        : { "List-Unsubscribe": `<${oneClickUnsubscribeUrl(i.client.id, "email")}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    attachments: i.attachments,
    workspaceId: i.workspace.id,
  });
  if (!res.ok) {
    await log(q, i, recipient, { status: "failed", error: res.error });
    return { status: "failed", reason: res.error };
  }
  const id = await log(q, i, recipient, { status: "sent", providerId: res.providerId });
  return { status: "sent", messageId: id };
}
