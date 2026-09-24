import type { Q, Row } from "../db";
import { enqueue, runDueJobs, type JobHandler } from "./queue";
import { loadEntitlementQ } from "../entitlements";
import { can } from "../tiers";
import { planReminders, payUrl, quietNow, reminderVars, renderReminder, stepKey, todayIn } from "../reminders";
import { sendToClient } from "../messaging";
import { generateReport, sendReport } from "../report-service";
import { localParts, previousPeriod } from "../time";
import { audit } from "../audit";
import { reconcileAppsumoCsv } from "../appsumo";
import { parseCsv } from "../metrics";
import { workspaceStripe } from "../stripe-connect";
import { markInvoicePaid } from "../invoices";
import { button, emailLayout, sendEmail } from "../email";
import { env } from "../env";

async function loadWs(q: Q, workspaceId: string) {
  const ws = await q.maybe("select * from workspaces where id = $1", [workspaceId]);
  if (!ws) return null;
  const ent = await loadEntitlementQ(q, ws.owner_id);
  return { ws, ent };
}

// ---------------------------------------------------------------- reminders

/** Finds open invoices that may need a reminder and queues one job per invoice per hour. */
export async function scanReminders(q: Q, now = new Date()) {
  const rows = await q.many<{ id: string; workspace_id: string }>(
    `select i.id, i.workspace_id from invoices i
     join clients c on c.id = i.client_id
     where i.status = 'open' and not c.reminders_paused and c.archived_at is null
       and i.due_date between (current_date - 95) and (current_date + 35)`,
  );
  const hour = now.toISOString().slice(0, 13);
  let queued = 0;
  for (const r of rows) {
    if (await enqueue(q, "reminders.invoice", { invoiceId: r.id }, { dedupeKey: `rem:${r.id}:${hour}`, maxAttempts: 3 })) queued++;
  }
  return queued;
}

export async function processInvoiceReminders(q: Q, invoiceId: string, now = new Date()) {
  // Serialize per invoice so two workers can never double-send.
  await q.exec("select pg_advisory_xact_lock(hashtext($1))", [`reminders:${invoiceId}`]);
  const invoice = await q.maybe("select * from invoices where id = $1", [invoiceId]);
  if (!invoice || invoice.status !== "open") return { sent: 0, reason: "not open" };
  const client = await q.one("select * from clients where id = $1", [invoice.client_id]);
  if (client.reminders_paused) return { sent: 0, reason: "paused" };
  const loaded = await loadWs(q, invoice.workspace_id);
  if (!loaded) return { sent: 0, reason: "no workspace" };
  const { ws, ent } = loaded;
  if (ent.mode !== "full" || !can(ent, "email_reminders")) return { sent: 0, reason: "plan" };
  if (quietNow(now, ws, client)) return { sent: 0, reason: "quiet hours" };

  const tz = client.timezone || ws.timezone || "UTC";
  const todayLocal = todayIn(now, tz);
  const rules = await q.many("select * from reminder_rules where workspace_id = $1", [ws.id]);
  const handled = await q.many<{ step_key: string }>(
    // Sent and skipped steps are done (a skip = no consent, unsubscribed, quota...); failed steps are retried.
    `select distinct step_key from message_log where invoice_id = $1 and kind = 'reminder' and status in ('sent','skipped')`,
    [invoice.id],
  );
  const dueIso = String(invoice.due_date instanceof Date ? invoice.due_date.toISOString() : invoice.due_date).slice(0, 10);
  const plan = planReminders({ dueDate: dueIso, todayLocal, rules: rules as any, handledStepKeys: new Set(handled.map((h) => h.step_key)) });
  for (const r of plan.supersede) {
    await q.exec(
      `insert into message_log (workspace_id, client_id, invoice_id, kind, channel, step_key, status, skip_reason)
       values ($1,$2,$3,'reminder',$4,$5,'skipped','Superseded by a later reminder step')`,
      [ws.id, client.id, invoice.id, r.channel, stepKey(r)],
    );
  }
  let sent = 0;
  for (const rule of plan.send) {
    const vars = reminderVars(invoice, client, ws, todayLocal);
    const { subject, body } = renderReminder(rule, vars);
    const outcome = await sendToClient(q, {
      workspace: ws,
      client,
      ent,
      channel: rule.channel as any,
      kind: "reminder",
      subject,
      bodyText: body,
      cta: { url: payUrl(invoice.id), label: "View & pay invoice" },
      invoiceId: invoice.id,
      stepKey: stepKey(rule),
      whatsappContentSid: rule.whatsapp_content_sid,
      whatsappVariables: { "1": vars.contactName, "2": vars.invoiceNumber, "3": vars.amount, "4": vars.dueDate, "5": payUrl(invoice.id) },
    });
    if (outcome.status === "sent") sent++;
    // A failed delivery is logged (status 'failed') and retried by the next hourly scan; we don't throw,
    // so a sent message on another channel in this same run is never rolled back and re-sent.
  }
  return { sent };
}

// ---------------------------------------------------------------- reports

/** Queues report generation for every client whose report day is today (in the workspace timezone). */
export async function scanScheduledReports(q: Q, now = new Date()) {
  const clients = await q.many<Row>(
    `select c.id, c.workspace_id, c.report_day, coalesce(c.timezone, w.timezone) as tz
     from clients c join workspaces w on w.id = c.workspace_id
     where c.report_day is not null and c.archived_at is null`,
  );
  let queued = 0;
  for (const c of clients) {
    const local = localParts(now, c.tz || "UTC");
    if (local.day < c.report_day || local.hour < 8) continue;
    const period = previousPeriod(`${local.year}-${String(local.month).padStart(2, "0")}`);
    if (await enqueue(q, "reports.monthly", { clientId: c.id, period }, { dedupeKey: `report:${c.id}:${period}`, maxAttempts: 4 })) queued++;
  }
  return queued;
}

export async function runMonthlyReport(q: Q, clientId: string, period: string) {
  const client = await q.maybe("select * from clients where id = $1", [clientId]);
  if (!client) return;
  const loaded = await loadWs(q, client.workspace_id);
  if (!loaded) return;
  const { ws, ent } = loaded;
  if (ent.mode !== "full" || !can(ent, "scheduled_reports")) return;
  const { report } = await generateReport(q, ws, ent, client, period);
  if (report.status === "sent") return;
  if (client.report_auto_send) {
    const outcome = await sendReport(q, ws, ent, report.id, null);
    if (outcome.status === "failed") throw new Error(`Report delivery failed: ${outcome.reason}`);
  } else {
    const owner = await q.one("select email from users where id = $1", [ws.owner_id]);
    await sendEmail({
      to: owner.email,
      subject: `Draft ready: ${client.name} ${period} wrap`,
      html: emailLayout({
        title: `${client.name}'s wrap is ready to review`,
        bodyHtml: `<p>We generated the ${period} report for ${client.name}. Review and edit it, then send it with one click.</p>${button(`${env.APP_URL}/app/clients/${client.id}/reports/${report.id}`, "Review draft")}`,
        showPoweredBy: false,
      }),
      workspaceId: ws.id,
    });
  }
}

// ---------------------------------------------------------------- licensing cleanup

/**
 * After a license is deactivated, data stays read-only and exportable for 30 days.
 * After that, client data is permanently removed (the account itself remains, on the Free plan).
 */
export async function cleanupExpiredLicenses(q: Q) {
  const users = await q.many<{ user_id: string }>(
    `select distinct l.user_id from licenses l
     where l.status = 'deactivated' and l.superseded_by is null and l.user_id is not null
       and l.deactivated_at < now() - interval '30 days'`,
  );
  let purged = 0;
  for (const u of users) {
    const ent = await loadEntitlementQ(q, u.user_id);
    if (ent.mode !== "expired") continue;
    const ws = await q.maybe("select id from workspaces where owner_id = $1", [u.user_id]);
    if (!ws) continue;
    const n = await q.exec("delete from clients where workspace_id = $1", [ws.id]);
    await q.exec("update licenses set user_id = null where user_id = $1 and status = 'deactivated' and superseded_by is null", [u.user_id]);
    if (n > 0) purged++;
    await audit(q, { workspaceId: ws.id, userId: u.user_id, actor: "system", action: "license.data_purged", metadata: { clientsRemoved: n } });
  }
  return purged;
}

// ---------------------------------------------------------------- stripe fallback sync

/** Webhooks are primary; this catches payments if a webhook was missed. */
export async function syncOpenInvoicePayments(q: Q) {
  const invoices = await q.many(
    `select i.* from invoices i where i.status = 'open' and i.stripe_payment_link_id is not null
       and i.updated_at > now() - interval '120 days' order by i.updated_at desc limit 200`,
  );
  let paid = 0;
  const cache = new Map<string, Row | null>();
  for (const inv of invoices) {
    if (!cache.has(inv.workspace_id)) cache.set(inv.workspace_id, await q.maybe("select * from workspaces where id = $1", [inv.workspace_id]));
    const ws = cache.get(inv.workspace_id);
    const stripe = ws ? workspaceStripe(ws) : null;
    if (!stripe) continue;
    try {
      const sessions = await stripe.checkout.sessions.list({ payment_link: inv.stripe_payment_link_id, limit: 5 });
      const done = sessions.data.find((s) => s.payment_status === "paid");
      if (done) {
        const r = await markInvoicePaid(q, {
          invoiceId: inv.id,
          amountCents: done.amount_total ?? undefined,
          method: "stripe",
          stripeEventId: `sync_${done.id}`,
          paymentIntent: typeof done.payment_intent === "string" ? done.payment_intent : undefined,
          actor: "stripe",
        });
        if (r.changed) paid++;
      }
    } catch {
      /* key revoked etc.; try again next run */
    }
  }
  return paid;
}

// ---------------------------------------------------------------- housekeeping

export async function housekeeping(q: Q) {
  await q.exec("delete from rate_limits where window_start < now() - interval '1 day'");
  await q.exec("delete from sessions where expires_at < now()");
  await q.exec("delete from auth_tokens where expires_at < now() - interval '7 days'");
  await q.exec("delete from jobs where status = 'done' and finished_at < now() - interval '14 days'");
  await q.exec("delete from pending_redemptions where created_at < now() - interval '90 days'");
}

export const HANDLERS: Record<string, JobHandler> = {
  "reminders.scan": async (_p, q) => {
    await scanReminders(q);
  },
  "reminders.invoice": async (p, q) => {
    await processInvoiceReminders(q, p.invoiceId);
  },
  "reports.scan": async (_p, q) => {
    await scanScheduledReports(q);
  },
  "reports.monthly": async (p, q) => {
    await runMonthlyReport(q, p.clientId, p.period);
  },
  "licenses.cleanup": async (_p, q) => {
    await cleanupExpiredLicenses(q);
  },
  "appsumo.reconcile": async (p, q) => {
    const parsed = parseCsv(p.csv);
    const summary = await reconcileAppsumoCsv(q, parsed.rows, parsed.headers);
    await audit(q, { workspaceId: null, actor: "system", action: "appsumo.reconciled", metadata: summary as any });
  },
  "invoices.sync": async (_p, q) => {
    await syncOpenInvoicePayments(q);
  },
  housekeeping: async (_p, q) => {
    await housekeeping(q);
  },
};

/** Called by /api/cron (Vercel Cron) and scripts/worker.ts. Enqueues periodic jobs, then runs due jobs. */
export async function tick(now = new Date()) {
  const { withService } = await import("../db");
  const hour = now.toISOString().slice(0, 13);
  const day = now.toISOString().slice(0, 10);
  const quarter = `${hour}:${Math.floor(now.getUTCMinutes() / 15)}`;
  await withService(async (q) => {
    await enqueue(q, "reminders.scan", {}, { dedupeKey: `reminders.scan:${quarter}` });
    await enqueue(q, "reports.scan", {}, { dedupeKey: `reports.scan:${hour}` });
    await enqueue(q, "invoices.sync", {}, { dedupeKey: `invoices.sync:${hour}` });
    await enqueue(q, "licenses.cleanup", {}, { dedupeKey: `licenses.cleanup:${day}` });
    await enqueue(q, "housekeeping", {}, { dedupeKey: `housekeeping:${day}` });
  });
  let total = { ran: 0, failed: 0, dead: 0 };
  // Drain in batches (bounded so a serverless invocation finishes in time).
  for (let i = 0; i < 8; i++) {
    const r = await runDueJobs(HANDLERS, 25);
    total = { ran: total.ran + r.ran, failed: total.failed + r.failed, dead: total.dead + r.dead };
    if (r.ran === 0) break;
  }
  return total;
}
