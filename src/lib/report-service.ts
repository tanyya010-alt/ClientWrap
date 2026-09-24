import type { Q, Row } from "./db";
import { buildSnapshot, generateNarrative, type ReportSnapshot } from "./reports";
import { reportPdf } from "./pdf";
import { sendToClient, showPoweredBy } from "./messaging";
import { ensurePortalLink, portalUrlFor } from "./portal";
import { consumeUsage } from "./entitlements";
import { aiConfigured, AIError } from "./ai";
import type { Entitlement } from "./tiers";
import { audit } from "./audit";

export async function generateReport(
  q: Q,
  ws: Row,
  ent: Entitlement,
  client: Row,
  period: string,
  opts: { regenerateNarrative?: boolean } = {},
): Promise<{ report: Row; aiError?: string }> {
  const existing = await q.maybe("select * from reports where client_id = $1 and period = $2", [client.id, period]);
  const snapshot = await buildSnapshot(q, client, period);
  if (existing && existing.status === "sent" && !opts.regenerateNarrative) {
    return { report: existing };
  }
  let narrative = existing?.narrative ?? "";
  let nextStep = existing?.next_step ?? "";
  let ai = existing?.ai_generated ?? false;
  let aiError: string | undefined;
  if (!existing || opts.regenerateNarrative || !narrative) {
    let useAi = aiConfigured(ws);
    if (useAi) {
      try {
        await consumeUsage(q, ws.id, ent, "ai_generations");
      } catch (e) {
        aiError = (e as Error).message;
        useAi = false;
      }
    }
    try {
      const n = await generateNarrative(useAi ? ws : { ...ws, ai_provider: null, ai_api_key_enc: null }, client, snapshot);
      narrative = n.narrative;
      nextStep = n.nextStep;
      ai = n.ai;
    } catch (e) {
      if (!(e instanceof AIError)) throw e;
      aiError = e.message;
      const n = await generateNarrative({ ...ws, ai_provider: null, ai_api_key_enc: null }, client, snapshot);
      narrative = n.narrative;
      nextStep = n.nextStep;
      ai = false;
    }
  }
  const report = await q.one(
    `insert into reports (workspace_id, client_id, period, data_snapshot, narrative, next_step, ai_generated)
     values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (client_id, period) do update set data_snapshot = excluded.data_snapshot,
       narrative = excluded.narrative, next_step = excluded.next_step, ai_generated = excluded.ai_generated,
       status = 'draft', updated_at = now()
     returning *`,
    [ws.id, client.id, period, JSON.stringify(snapshot), narrative, nextStep, ai],
  );
  return { report, aiError };
}

export async function renderReportPdf(q: Q, ws: Row, ent: Entitlement, reportId: string): Promise<{ pdf: Buffer; report: Row; client: Row }> {
  const report = await q.one("select * from reports where id = $1", [reportId]);
  const client = await q.one("select * from clients where id = $1", [report.client_id]);
  const pdf = await reportPdf({
    brand: { name: ws.name, color: client.brand_color || ws.brand_color, logo: client.logo_data || ws.logo_data },
    clientName: client.name,
    snapshot: report.data_snapshot as ReportSnapshot,
    narrative: report.narrative,
    nextStep: report.next_step,
    poweredBy: showPoweredBy(ws, ent),
  });
  return { pdf, report, client };
}

export async function sendReport(q: Q, ws: Row, ent: Entitlement, reportId: string, userId: string | null, opts: { to?: string } = {}) {
  const { pdf, report, client } = await renderReportPdf(q, ws, ent, reportId);
  const link = await ensurePortalLink(q, ws.id, client.id);
  const url = `${portalUrlFor(link.id, ws, ent)}?report=${report.period}`;
  const snap = report.data_snapshot as ReportSnapshot;
  const outcome = await sendToClient(q, {
    workspace: ws,
    client,
    ent,
    channel: "email",
    kind: "report",
    subject: `${client.name}: your ${snap.periodLabel} results`,
    bodyText: `Hi ${client.contact_name || client.name},\n\nYour ${snap.periodLabel} wrap is ready: the headline numbers, what changed, and what we suggest next.\n\n${report.narrative}\n\nSuggested next step: ${report.next_step}\n\nThe full report is attached as a PDF and always available on your results page.\n\n${ws.name}`,
    cta: { url, label: "Open your results page" },
    reportId,
    attachments: [{ filename: `${client.name.replace(/[^A-Za-z0-9]+/g, "-")}-${report.period}.pdf`, content: pdf }],
    to: opts.to,
  });
  if (outcome.status === "sent" && !opts.to) {
    await q.exec("update reports set status = 'sent', sent_at = now(), sent_to = $2 where id = $1", [reportId, client.contact_email]);
  }
  await audit(q, { workspaceId: ws.id, userId, actor: userId ? "user" : "system", action: opts.to ? "report.test_sent" : "report.sent", targetType: "report", targetId: reportId, metadata: { outcome: outcome.status, reason: outcome.reason ?? null } });
  return outcome;
}
