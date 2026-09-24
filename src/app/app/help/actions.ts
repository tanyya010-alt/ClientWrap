"use server";

import { requireApp } from "@/lib/auth";
import { withService } from "@/lib/db";
import { sendEmail, escapeHtml } from "@/lib/email";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/ratelimit";
import { str } from "@/lib/actions";
import type { ActionState } from "@/lib/action-types";
import { PLANS } from "@/lib/tiers";

export async function supportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireApp();
  const subject = str(fd, "subject").slice(0, 200);
  const message = str(fd, "message").slice(0, 5000);
  if (!subject || message.length < 10) return { error: "Please add a subject and a short description." };
  if (!(await rateLimit(`support:${ctx.user.id}`, 10, 3600))) return { error: "You've sent several messages; we'll get back to you soon." };
  await withService((q) =>
    q.exec("insert into support_tickets (user_id, workspace_id, email, subject, message) values ($1,$2,$3,$4,$5)", [ctx.user.id, ctx.workspace.id, ctx.user.email, subject, message]),
  );
  await sendEmail({
    to: env.SUPPORT_EMAIL,
    replyTo: ctx.user.email,
    subject: `[Support] ${subject}`,
    html: `<p><strong>From:</strong> ${escapeHtml(ctx.user.email)} · plan ${PLANS[ctx.entitlement.plan].name} (${ctx.entitlement.source}${ctx.entitlement.licenseKey ? ` ${escapeHtml(ctx.entitlement.licenseKey)}` : ""})</p><pre style="white-space:pre-wrap">${escapeHtml(message)}</pre>`,
    text: message,
  });
  await sendEmail({
    to: ctx.user.email,
    subject: `We got your message: ${subject}`,
    html: `<p>Thanks for reaching out. We reply within one business day. Your message:</p><pre style="white-space:pre-wrap">${escapeHtml(message)}</pre>`,
  });
  return { ok: true, message: "Thanks! We've received your message and will reply by email, usually within one business day." };
}
