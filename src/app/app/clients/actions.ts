"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tenantAction, str, optStr, UserError } from "@/lib/actions";
import type { ActionState } from "@/lib/action-types";
import { createClient, fileToDataUrl } from "@/lib/clients";
import { assertFeature, assertWritable } from "@/lib/entitlements";
import { audit } from "@/lib/audit";
import { applyMapping, cleanEvent, errorReportCsv, insertEvents, parseCsv, suggestMapping, metricKey, type CsvMapping, type CleanEvent } from "@/lib/metrics";
import { encrypt, randomToken, decryptOrNull } from "@/lib/crypto";
import { rotatePortalLink } from "@/lib/portal";
import { isValidTimeZone } from "@/lib/time";
import { generateReport, sendReport } from "@/lib/report-service";
import { sha256 } from "@/lib/crypto";

const hex = /^#[0-9a-fA-F]{6}$/;

export async function createClientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const r = await tenantAction(async (ctx, q) => {
    const name = str(fd, "name");
    if (!name) throw new UserError("Give the client a name.");
    const tz = optStr(fd, "timezone");
    if (tz && !isValidTimeZone(tz)) throw new UserError("Unknown timezone.");
    const email = optStr(fd, "contact_email");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError("Enter a valid contact email.");
    const fee = optStr(fd, "monthly_fee");
    const client = await createClient(q, ctx.workspace.id, ctx.entitlement, {
      name,
      contactName: optStr(fd, "contact_name"),
      contactEmail: email,
      contactPhone: optStr(fd, "contact_phone"),
      timezone: tz,
      template: optStr(fd, "template") ?? ctx.workspace.service_type,
      monthlyFeeCents: fee ? Math.round(Number(fee) * 100) : null,
    });
    id = client.id;
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "client.created", targetType: "client", targetId: client.id });
  }, { revalidate: ["/app"] });
  if (r?.error) return r;
  redirect(`/app/clients/${id}/data?new=1`);
}

export async function updateClientAction(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertWritable(ctx.entitlement);
    const name = str(fd, "name");
    if (!name) throw new UserError("Client name is required.");
    const tz = optStr(fd, "timezone");
    if (tz && !isValidTimeZone(tz)) throw new UserError("Unknown timezone.");
    const color = optStr(fd, "brand_color");
    if (color && !hex.test(color)) throw new UserError("Brand color must be a hex value like #4f46e5.");
    const reportDay = optStr(fd, "report_day");
    const day = reportDay ? Number(reportDay) : null;
    if (day !== null && (day < 1 || day > 28)) throw new UserError("Report day must be between 1 and 28.");
    if (day !== null) assertFeature(ctx.entitlement, "scheduled_reports");
    const logo = await fileToDataUrl(fd.get("logo") as File | null);
    const fee = optStr(fd, "monthly_fee");
    await q.exec(
      `update clients set name=$2, contact_name=$3, contact_email=$4, contact_phone=$5, timezone=$6, brand_color=$7,
         service_description=$8, monthly_fee_cents=$9, contract_end_date=$10, report_day=$11, report_auto_send=$12,
         reminders_paused=$13, logo_data = case when $14::text is not null then $14 when $15 then null else logo_data end, updated_at=now()
       where id=$1`,
      [
        clientId, name, optStr(fd, "contact_name"), optStr(fd, "contact_email"), optStr(fd, "contact_phone"), tz, color,
        optStr(fd, "service_description"), fee ? Math.round(Number(fee) * 100) : null, optStr(fd, "contract_end_date"), day,
        fd.get("report_auto_send") === "on", fd.get("reminders_paused") === "on", logo, fd.get("remove_logo") === "on",
      ],
    );
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "client.updated", targetType: "client", targetId: clientId, metadata: { reminders_paused: fd.get("reminders_paused") === "on" } });
    return { ok: true, message: "Saved." };
  }, { revalidate: [`/app/clients/${clientId}`] });
}

export async function toggleRemindersAction(clientId: string, paused: boolean) {
  await tenantAction(async (ctx, q) => {
    await q.exec("update clients set reminders_paused = $2 where id = $1", [clientId, paused]);
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: paused ? "client.reminders_paused" : "client.reminders_resumed", targetType: "client", targetId: clientId });
  }, { revalidate: [`/app/clients/${clientId}`, "/app/invoices"] });
}

export async function saveMetricConfigAction(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertWritable(ctx.entitlement);
    const keys = fd.getAll("key").map(String);
    const cfg: Record<string, any> = {};
    keys.forEach((k, i) => {
      const label = String(fd.getAll("label")[i] ?? "").trim();
      if (!label) return;
      cfg[k] = {
        label,
        unit: String(fd.getAll("unit")[i] ?? "").trim().slice(0, 24),
        agg: ["sum", "avg", "last"].includes(String(fd.getAll("agg")[i])) ? String(fd.getAll("agg")[i]) : "sum",
        better: String(fd.getAll("better")[i]) === "down" ? "down" : "up",
        hidden: fd.getAll("hidden").map(String).includes(k),
      };
    });
    const newLabel = str(fd, "new_label");
    if (newLabel) {
      const k = metricKey(newLabel);
      if (!k) throw new UserError("Metric name needs letters or numbers.");
      cfg[k] = { label: newLabel, unit: str(fd, "new_unit").slice(0, 24), agg: str(fd, "new_agg") || "sum", better: str(fd, "new_better") === "down" ? "down" : "up" };
    }
    await q.exec("update clients set metric_config = $2 where id = $1", [clientId, JSON.stringify(cfg)]);
    return { ok: true, message: "Metrics saved." };
  }, { revalidate: [`/app/clients/${clientId}`] });
}

export async function archiveClientAction(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const archive = fd.get("archive") === "1";
  const r = await tenantAction(async (ctx, q) => {
    if (!archive) {
      const { assertClientCapacity } = await import("@/lib/clients");
      await assertClientCapacity(q, ctx.entitlement);
    }
    await q.exec("update clients set archived_at = case when $2 then now() else null end where id = $1", [clientId, archive]);
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: archive ? "client.archived" : "client.restored", targetType: "client", targetId: clientId });
  }, { revalidate: ["/app/clients"] });
  if (r?.error) return r;
  redirect("/app/clients");
}

export async function deleteClientAction(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction(async (ctx, q) => {
    const c = await q.one("select name from clients where id = $1", [clientId]);
    if (str(fd, "confirm") !== c.name) throw new UserError(`Type "${c.name}" to confirm.`);
    await q.exec("delete from clients where id = $1", [clientId]);
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "client.deleted", targetType: "client", targetId: clientId, metadata: { name: c.name } });
  }, { revalidate: ["/app/clients"] });
  if (r?.error) return r;
  redirect("/app/clients");
}

export async function rotatePortalAction(clientId: string): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    await rotatePortalLink(q, ctx.workspace.id, clientId);
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "portal.rotated", targetType: "client", targetId: clientId });
    return { ok: true, message: "New link created. The old link no longer works." };
  }, { revalidate: [`/app/clients/${clientId}`] });
}

export async function recordConsentAction(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    const channel = str(fd, "channel");
    const action = str(fd, "action");
    if (!["email", "sms", "whatsapp"].includes(channel) || !["granted", "revoked", "resubscribed"].includes(action)) throw new UserError("Invalid consent option.");
    const evidence = str(fd, "evidence");
    if (action === "granted" && evidence.length < 5) throw new UserError("Describe how the client gave consent (e.g. 'Signed contract clause 7, 2026-09-01').");
    await q.exec(
      "insert into consent_records (workspace_id, client_id, channel, action, source, evidence) values ($1,$2,$3,$4,'provider',$5)",
      [ctx.workspace.id, clientId, channel, action, evidence || null],
    );
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: `consent.${action}`, targetType: "client", targetId: clientId, metadata: { channel } });
    return { ok: true, message: "Consent recorded." };
  }, { revalidate: [`/app/clients/${clientId}`] });
}

// ---------------------------------------------------------------- data intake

export async function addMetricsAction(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertWritable(ctx.entitlement);
    const date = str(fd, "date");
    const metrics = fd.getAll("metric").map(String);
    const values = fd.getAll("value").map(String);
    const units = fd.getAll("unit").map(String);
    const events: CleanEvent[] = [];
    const errors: string[] = [];
    metrics.forEach((m, i) => {
      if (!m.trim() || !String(values[i] ?? "").trim()) return;
      const r = cleanEvent({ metric: m, value: values[i], unit: units[i] ?? "", timestamp: date || undefined });
      if (r.ok) events.push(r.event);
      else errors.push(`${m}: ${r.error}`);
    });
    if (errors.length) throw new UserError(errors.join(" · "));
    if (events.length === 0) throw new UserError("Enter at least one value.");
    const res = await insertEvents(q, ctx.workspace.id, clientId, events, "manual");
    return { ok: true, message: `Saved ${res.inserted} value${res.inserted === 1 ? "" : "s"}.` };
  }, { revalidate: [`/app/clients/${clientId}`] });
}

export async function deleteEventAction(clientId: string, eventId: string) {
  await tenantAction(async (ctx, q) => {
    assertWritable(ctx.entitlement);
    await q.exec("delete from metric_events where id = $1 and client_id = $2", [eventId, clientId]);
  }, { revalidate: [`/app/clients/${clientId}`] });
}

export async function previewCsvAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (ctx) => {
    assertFeature(ctx.entitlement, "csv_import");
    const file = fd.get("file") as File | null;
    if (!file || file.size === 0) throw new UserError("Choose a CSV file.");
    if (file.size > 2_000_000) throw new UserError("CSV must be under 2 MB (about 20,000 rows). Split larger files.");
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.headers.length < 2) throw new UserError("The CSV needs a header row and at least two columns.");
    if (parsed.rows.length === 0) throw new UserError("The CSV has no data rows.");
    if (parsed.rows.length > 20000) throw new UserError("Too many rows (max 20,000).");
    return { ok: true, data: { text, filename: file.name, headers: parsed.headers, sample: parsed.rows.slice(0, 5), rowCount: parsed.rows.length, suggestion: suggestMapping(parsed.headers), parseErrors: parsed.parseErrors } };
  });
}

export async function importCsvAction(clientId: string, csvText: string, filename: string, mapping: CsvMapping): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertFeature(ctx.entitlement, "csv_import");
    const parsed = parseCsv(csvText);
    const { events, errors } = applyMapping(parsed.rows, mapping, { fileKey: sha256(csvText).slice(0, 12) });
    const res = events.length ? await insertEvents(q, ctx.workspace.id, clientId, events, "csv") : { inserted: 0, duplicates: 0 };
    await q.exec(
      "insert into csv_imports (workspace_id, client_id, filename, mapping, rows_total, rows_imported, errors) values ($1,$2,$3,$4,$5,$6,$7)",
      [ctx.workspace.id, clientId, filename.slice(0, 200), JSON.stringify(mapping), parsed.rows.length, res.inserted, JSON.stringify(errors.slice(0, 500))],
    );
    return {
      ok: true,
      message: `Imported ${res.inserted} value${res.inserted === 1 ? "" : "s"}${res.duplicates ? `, skipped ${res.duplicates} already imported` : ""}${errors.length ? `, ${errors.length} row error${errors.length === 1 ? "" : "s"}` : ""}.`,
      data: { errors: errors.slice(0, 50), errorCsv: errors.length ? errorReportCsv(errors) : null, inserted: res.inserted },
    };
  }, { revalidate: [`/app/clients/${clientId}`] });
}

export async function createWebhookAction(clientId: string): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertFeature(ctx.entitlement, "metrics_webhook");
    await q.exec("update webhook_secrets set revoked_at = now() where client_id = $1 and revoked_at is null", [clientId]);
    const secret = `cwsec_${randomToken(24)}`;
    await q.exec("insert into webhook_secrets (workspace_id, client_id, public_token, secret_enc) values ($1,$2,$3,$4)", [
      ctx.workspace.id, clientId, randomToken(18), encrypt(secret),
    ]);
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "webhook.created", targetType: "client", targetId: clientId });
    return { ok: true, message: "Webhook ready. Copy the URL and secret into your automation tool." };
  }, { revalidate: [`/app/clients/${clientId}/data`] });
}

export async function revokeWebhookAction(clientId: string): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    await q.exec("update webhook_secrets set revoked_at = now() where client_id = $1 and revoked_at is null", [clientId]);
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "webhook.revoked", targetType: "client", targetId: clientId });
    return { ok: true, message: "Webhook disabled." };
  }, { revalidate: [`/app/clients/${clientId}/data`] });
}

export async function revealWebhookSecret(clientId: string): Promise<string | null> {
  const r = await tenantAction(async (_ctx, q) => {
    const h = await q.maybe("select secret_enc from webhook_secrets where client_id = $1 and revoked_at is null", [clientId]);
    return { ok: true, data: h ? decryptOrNull(h.secret_enc) : null };
  });
  return r?.data ?? null;
}

// ---------------------------------------------------------------- reports

const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month");

export async function generateReportAction(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  let reportId = "";
  let aiWarn: string | undefined;
  const r = await tenantAction(async (ctx, q) => {
    assertFeature(ctx.entitlement, "monthly_reports");
    const period = periodSchema.parse(str(fd, "period"));
    const client = await q.one("select * from clients where id = $1", [clientId]);
    const { report, aiError } = await generateReport(q, ctx.workspace, ctx.entitlement, client, period, { regenerateNarrative: fd.get("regenerate") === "1" });
    reportId = report.id;
    aiWarn = aiError;
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "report.generated", targetType: "report", targetId: report.id, metadata: { period, ai: report.ai_generated } });
  });
  if (r?.error) return r;
  redirect(`/app/clients/${clientId}/reports/${reportId}${aiWarn ? `?ai_error=${encodeURIComponent(aiWarn)}` : ""}`);
}

export async function saveReportAction(reportId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertWritable(ctx.entitlement);
    const narrative = str(fd, "narrative").slice(0, 8000);
    const nextStep = str(fd, "next_step").slice(0, 2000);
    await q.exec("update reports set narrative = $2, next_step = $3, updated_at = now() where id = $1", [reportId, narrative, nextStep]);
    return { ok: true, message: "Saved." };
  }, { revalidate: ["/app/clients"] });
}

export async function sendReportAction(reportId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertFeature(ctx.entitlement, "monthly_reports");
    if (!ctx.user.email_verified_at) throw new UserError("Confirm your email address first (check your inbox), then send.");
    const narrative = fd.get("narrative");
    if (typeof narrative === "string") {
      await q.exec("update reports set narrative = $2, next_step = $3, updated_at = now() where id = $1", [reportId, narrative.slice(0, 8000), str(fd, "next_step").slice(0, 2000)]);
    }
    const test = fd.get("test") === "1";
    const outcome = await sendReport(q, ctx.workspace, ctx.entitlement, reportId, ctx.user.id, test ? { to: ctx.user.email } : {});
    if (outcome.status !== "sent") throw new UserError(`Not sent: ${outcome.reason}`);
    return { ok: true, message: test ? `Test sent to ${ctx.user.email}.` : "Sent! Your client has the report and their results link." };
  }, { revalidate: ["/app/clients", "/app"] });
}

export async function deleteReportAction(clientId: string, reportId: string) {
  await tenantAction(async (ctx, q) => {
    assertWritable(ctx.entitlement);
    await q.exec("delete from reports where id = $1", [reportId]);
  }, { revalidate: [`/app/clients/${clientId}`] });
  revalidatePath(`/app/clients/${clientId}`);
  redirect(`/app/clients/${clientId}`);
}
