import { withService } from "./db";
import { env, isProd } from "./env";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: { filename: string; content: Buffer }[];
  workspaceId?: string | null;
}

export interface SendResult {
  ok: boolean;
  providerId?: string;
  error?: string;
}

/**
 * Sends via Resend when RESEND_API_KEY is set. Without a key (development/test) the message is
 * written to email_outbox with provider "outbox" and shown at /dev/mailbox.
 * Every message is recorded in email_outbox either way.
 */
export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  const from = msg.from ?? env.EMAIL_FROM;
  let result: SendResult;
  let provider = "outbox";
  if (env.RESEND_API_KEY) {
    provider = "resend";
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          reply_to: msg.replyTo,
          headers: msg.headers,
          attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      result = res.ok ? { ok: true, providerId: body.id } : { ok: false, error: body.message ?? `HTTP ${res.status}` };
    } catch (e) {
      result = { ok: false, error: (e as Error).message };
    }
  } else {
    if (isProd() && process.env.ALLOW_OUTBOX_EMAIL !== "true") {
      result = { ok: false, error: "Email provider is not configured (RESEND_API_KEY missing)" };
    } else {
      result = { ok: true, providerId: `outbox_${Date.now()}` };
    }
  }
  await withService((q) =>
    q.exec(
      `insert into email_outbox (workspace_id, to_address, from_address, subject, html, text_body, provider, provider_id, status, error)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [msg.workspaceId ?? null, msg.to, from, msg.subject, msg.html, msg.text ?? null, provider, result.providerId ?? null,
        result.ok ? "sent" : "failed", result.error ?? null],
    ),
  );
  return result;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Simple, email-client-safe layout. */
export function emailLayout(opts: {
  title: string;
  bodyHtml: string;
  brandColor?: string;
  brandName?: string;
  footerHtml?: string;
  showPoweredBy?: boolean;
}): string {
  const color = opts.brandColor ?? "#4f46e5";
  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:${color};color:#fff;padding:18px 24px;font-weight:600;font-size:16px">${escapeHtml(opts.brandName ?? "ClientWrap")}</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55">
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(opts.title)}</h1>
${opts.bodyHtml}
</td></tr>
<tr><td style="padding:16px 24px;font-size:12px;color:#666;border-top:1px solid #eee">${opts.footerHtml ?? ""}
${opts.showPoweredBy === false ? "" : `<div style="margin-top:6px">Sent with ClientWrap</div>`}</td></tr>
</table></td></tr></table></body></html>`;
}

export function button(href: string, label: string, color = "#4f46e5"): string {
  return `<p style="margin:20px 0"><a href="${escapeHtml(href)}" style="background:${color};color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block;font-weight:600">${escapeHtml(label)}</a></p>`;
}
