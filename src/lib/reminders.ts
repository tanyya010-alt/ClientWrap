import type { Q, Row } from "./db";
import { addDaysIso, daysBetween, formatMoney, isQuietTime, localParts } from "./time";
import { env } from "./env";
import { signedToken } from "./crypto";

export type TemplateKey = "friendly_before" | "friendly_due" | "friendly_after" | "firm_after" | "final_after";

export const DEFAULT_REMINDER_RULES: { offset_days: number; template_key: TemplateKey }[] = [
  { offset_days: -3, template_key: "friendly_before" },
  { offset_days: 1, template_key: "friendly_after" },
  { offset_days: 7, template_key: "firm_after" },
  { offset_days: 14, template_key: "firm_after" },
  { offset_days: 30, template_key: "final_after" },
];

export async function createDefaultReminderRules(q: Q, workspaceId: string) {
  for (const r of DEFAULT_REMINDER_RULES) {
    await q.exec(
      `insert into reminder_rules (workspace_id, offset_days, channel, template_key) values ($1,$2,'email',$3)
       on conflict do nothing`,
      [workspaceId, r.offset_days, r.template_key],
    );
  }
}

export interface ReminderVars {
  clientName: string;
  contactName: string;
  providerName: string;
  invoiceNumber: string;
  amount: string;
  dueDate: string;
  daysOverdue: number;
  daysUntilDue: number;
}

/** Fixed, pre-approved templates. Every one stays friendly and professional. */
export const TEMPLATES: Record<TemplateKey, { label: string; subject: (v: ReminderVars) => string; body: (v: ReminderVars) => string }> = {
  friendly_before: {
    label: "Friendly heads-up before the due date",
    subject: (v) => `Invoice ${v.invoiceNumber} is due in ${v.daysUntilDue} day${v.daysUntilDue === 1 ? "" : "s"}`,
    body: (v) =>
      `Hi ${v.contactName},\n\nA quick heads-up that invoice ${v.invoiceNumber} for ${v.amount} is due on ${v.dueDate}. You can pay it online with the button below.\n\nThanks for working with us!\n${v.providerName}`,
  },
  friendly_due: {
    label: "Due today",
    subject: (v) => `Invoice ${v.invoiceNumber} is due today`,
    body: (v) =>
      `Hi ${v.contactName},\n\nJust a reminder that invoice ${v.invoiceNumber} for ${v.amount} is due today. You can pay it online with the button below.\n\nThank you,\n${v.providerName}`,
  },
  friendly_after: {
    label: "Friendly nudge after the due date",
    subject: (v) => `Friendly reminder: invoice ${v.invoiceNumber}`,
    body: (v) =>
      `Hi ${v.contactName},\n\nI hope all is well. Invoice ${v.invoiceNumber} for ${v.amount} was due on ${v.dueDate}. If it has already been paid, thank you and please ignore this note. Otherwise you can pay online below.\n\nBest,\n${v.providerName}`,
  },
  firm_after: {
    label: "Clear, polite follow-up",
    subject: (v) => `Invoice ${v.invoiceNumber} is ${v.daysOverdue} days past due`,
    body: (v) =>
      `Hi ${v.contactName},\n\nFollowing up on invoice ${v.invoiceNumber} for ${v.amount}, which was due on ${v.dueDate}. Could you let me know when we can expect payment? If anything about the invoice needs changing, just reply and we'll sort it out.\n\nThank you,\n${v.providerName}`,
  },
  final_after: {
    label: "Last automatic reminder",
    subject: (v) => `Checking in about invoice ${v.invoiceNumber}`,
    body: (v) =>
      `Hi ${v.contactName},\n\nThis is the last automatic reminder about invoice ${v.invoiceNumber} for ${v.amount} (due ${v.dueDate}). I'd love to get this settled; if there's a problem or you need a different arrangement, please reply and let's talk.\n\nBest regards,\n${v.providerName}`,
  },
};

export function stepKey(rule: { offset_days: number; channel: string }): string {
  return `${rule.channel}:${rule.offset_days}`;
}

export interface RuleLike {
  id?: string;
  offset_days: number;
  channel: string;
  enabled: boolean;
  template_key: string;
  custom_message?: string | null;
  whatsapp_content_sid?: string | null;
}

/**
 * Pure scheduling decision. Given the invoice due date, today's local date, rules and the step keys
 * already handled, returns which rule (if any) to send now and which older steps to mark as superseded.
 * Only the most recent due step per channel is sent, and only if it is at most `staleAfterDays` old,
 * so enabling reminders on an old invoice never fires a burst of messages.
 */
export function planReminders(input: {
  dueDate: string;
  todayLocal: string;
  rules: RuleLike[];
  handledStepKeys: Set<string>;
  staleAfterDays?: number;
}): { send: RuleLike[]; supersede: RuleLike[] } {
  const stale = input.staleAfterDays ?? 3;
  const send: RuleLike[] = [];
  const supersede: RuleLike[] = [];
  const byChannel = new Map<string, RuleLike[]>();
  for (const r of input.rules) {
    if (!r.enabled) continue;
    const list = byChannel.get(r.channel) ?? [];
    list.push(r);
    byChannel.set(r.channel, list);
  }
  for (const rules of byChannel.values()) {
    const due = rules
      .filter((r) => !input.handledStepKeys.has(stepKey(r)))
      .filter((r) => addDaysIso(input.dueDate, r.offset_days) <= input.todayLocal)
      .sort((a, b) => b.offset_days - a.offset_days);
    if (due.length === 0) continue;
    const [latest, ...older] = due;
    supersede.push(...older);
    const age = daysBetween(addDaysIso(input.dueDate, latest.offset_days), input.todayLocal);
    if (age <= stale) send.push(latest);
    else supersede.push(latest);
  }
  return { send, supersede };
}

export function payUrl(invoiceId: string): string {
  return `${env.APP_URL}/pay/${signedToken(invoiceId, "pay")}`;
}

export function reminderVars(invoice: Row, client: Row, workspace: Row, todayLocal: string): ReminderVars {
  const due = String(invoice.due_date instanceof Date ? invoice.due_date.toISOString() : invoice.due_date).slice(0, 10);
  return {
    clientName: client.name,
    contactName: client.contact_name || client.name,
    providerName: workspace.name,
    invoiceNumber: invoice.number,
    amount: formatMoney(invoice.total_cents, invoice.currency),
    dueDate: new Date(due + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }),
    daysOverdue: Math.max(0, daysBetween(due, todayLocal)),
    daysUntilDue: Math.max(0, daysBetween(todayLocal, due)),
  };
}

export function renderReminder(rule: RuleLike, vars: ReminderVars): { subject: string; body: string } {
  const tpl = TEMPLATES[(rule.template_key as TemplateKey) in TEMPLATES ? (rule.template_key as TemplateKey) : "friendly_after"];
  let body = tpl.body(vars);
  if (rule.custom_message && rule.custom_message.trim()) {
    body = rule.custom_message
      .replace(/\{\{\s*contact_name\s*\}\}/g, vars.contactName)
      .replace(/\{\{\s*client_name\s*\}\}/g, vars.clientName)
      .replace(/\{\{\s*invoice_number\s*\}\}/g, vars.invoiceNumber)
      .replace(/\{\{\s*amount\s*\}\}/g, vars.amount)
      .replace(/\{\{\s*due_date\s*\}\}/g, vars.dueDate)
      .replace(/\{\{\s*provider_name\s*\}\}/g, vars.providerName);
  }
  return { subject: tpl.subject(vars), body };
}

export function quietNow(now: Date, workspace: Row, client: Row): boolean {
  const tz = client.timezone || workspace.timezone || "UTC";
  return isQuietTime(now, tz, workspace.quiet_hours_start, workspace.quiet_hours_end, workspace.skip_weekends);
}

export function todayIn(now: Date, tz: string): string {
  return localParts(now, tz).isoDate;
}
