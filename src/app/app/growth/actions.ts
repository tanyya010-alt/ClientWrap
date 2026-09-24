"use server";

import { tenantAction, str, UserError } from "@/lib/actions";
import type { ActionState } from "@/lib/action-types";
import { assertFeature, consumeUsage } from "@/lib/entitlements";
import { generateCaseStudy, generateReferralRequest, generateRenewalSuggestion } from "@/lib/growth";
import { buildSnapshot, type ReportSnapshot } from "@/lib/reports";
import { aiConfigured } from "@/lib/ai";
import { sendToClient } from "@/lib/messaging";
import { assertTone } from "@/lib/tone";
import { signedToken, randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { currentPeriod } from "@/lib/entitlements";
import { previousPeriod } from "@/lib/time";
import type { Q } from "@/lib/db";
import type { AppContext } from "@/lib/auth";

async function latestSnapshot(q: Q, client: any): Promise<ReportSnapshot | null> {
  const r = await q.maybe("select data_snapshot from reports where client_id = $1 order by period desc limit 1", [client.id]);
  if (r) return r.data_snapshot as ReportSnapshot;
  const cur = await buildSnapshot(q, client, currentPeriod());
  return cur.eventCount > 0 ? cur : buildSnapshot(q, client, previousPeriod(currentPeriod()));
}

async function maybeCountAi(q: Q, ctx: AppContext) {
  if (aiConfigured(ctx.workspace)) await consumeUsage(q, ctx.workspace.id, ctx.entitlement, "ai_generations");
}

export async function generateRenewalAction(clientId: string): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertFeature(ctx.entitlement, "renewal_generator");
    const client = await q.one("select * from clients where id = $1", [clientId]);
    await maybeCountAi(q, ctx);
    const s = await generateRenewalSuggestion(ctx.workspace, client, await latestSnapshot(q, client));
    await q.exec("insert into renewal_suggestions (workspace_id, client_id, title, body) values ($1,$2,$3,$4)", [ctx.workspace.id, clientId, s.title, s.body]);
    return { ok: true, message: `Suggestion drafted${s.ai ? " with AI" : ""}. Review it, then show it on the client's page.` };
  }, { revalidate: ["/app/growth"] });
}

export async function saveRenewalAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertFeature(ctx.entitlement, "renewal_generator");
    const title = str(fd, "title");
    const body = str(fd, "body");
    if (!title || !body) throw new UserError("Title and text are required.");
    assertTone(body);
    const visible = fd.get("visible") === "on";
    const row = await q.one("update renewal_suggestions set title = $2, body = $3, visible_in_portal = $4 where id = $1 returning client_id", [id, title, body, visible]);
    if (visible) await q.exec("update renewal_suggestions set visible_in_portal = false where client_id = $1 and id <> $2", [row.client_id, id]);
    return { ok: true, message: visible ? "Saved and shown on the client's results page." : "Saved (hidden from client)." };
  }, { revalidate: ["/app/growth"] });
}

export async function deleteRenewalAction(id: string) {
  await tenantAction(async (_ctx, q) => {
    await q.exec("delete from renewal_suggestions where id = $1", [id]);
  }, { revalidate: ["/app/growth"] });
}

export async function generateCaseStudyAction(clientId: string): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertFeature(ctx.entitlement, "case_study_generator");
    const client = await q.one("select * from clients where id = $1", [clientId]);
    await maybeCountAi(q, ctx);
    const snap = await latestSnapshot(q, client);
    const cs = await generateCaseStudy(ctx.workspace, client, snap);
    const report = await q.maybe("select id from reports where client_id = $1 order by period desc limit 1", [clientId]);
    await q.exec("insert into case_studies (workspace_id, client_id, report_id, title, body) values ($1,$2,$3,$4,$5)", [ctx.workspace.id, clientId, report?.id ?? null, cs.title, cs.body]);
    return { ok: true, message: "Case-study draft created. It can only be published after your client approves it." };
  }, { revalidate: ["/app/growth"] });
}

export async function saveCaseStudyAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertFeature(ctx.entitlement, "case_study_generator");
    const cs = await q.one("select * from case_studies where id = $1", [id]);
    const title = str(fd, "title");
    const body = str(fd, "body");
    if (!title || !body) throw new UserError("Title and text are required.");
    // Any edit after approval requires re-approval.
    const changed = title !== cs.title || body !== cs.body;
    const status = changed && ["approved", "published", "pending_approval"].includes(cs.status) ? "draft" : cs.status;
    await q.exec(
      `update case_studies set title = $2, body = $3, status = $4,
         published_at = case when $4 = 'published' then published_at end,
         approved_at = case when $4 in ('approved','published') then approved_at end,
         approved_by_name = case when $4 in ('approved','published') then approved_by_name end,
         updated_at = now() where id = $1`,
      [id, title, body, status],
    );
    return { ok: true, message: status !== cs.status ? "Saved. Because the text changed, the client needs to approve it again." : "Saved." };
  }, { revalidate: ["/app/growth"] });
}

export async function requestApprovalAction(id: string): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertFeature(ctx.entitlement, "case_study_generator");
    if (!ctx.user.email_verified_at) throw new UserError("Confirm your email address first.");
    const cs = await q.one("select * from case_studies where id = $1", [id]);
    const client = await q.one("select * from clients where id = $1", [cs.client_id]);
    await q.exec("update case_studies set status = 'pending_approval', client_feedback = null, updated_at = now() where id = $1", [id]);
    const url = `${env.APP_URL}/approve/${signedToken(id, "cs-approve")}`;
    const out = await sendToClient(q, {
      workspace: ctx.workspace,
      client,
      ent: ctx.entitlement,
      channel: "email",
      kind: "case_study_approval",
      subject: `May we share your results? (${cs.title})`,
      bodyText: `Hi ${client.contact_name || client.name},\n\nWe'd love to share a short case study about the results we achieved together. Nothing is published without your OK: please review the draft and approve it, or tell us what to change.\n\nThank you!\n${ctx.workspace.name}`,
      cta: { url, label: "Review the draft" },
    });
    if (out.status !== "sent") throw new UserError(`Not sent: ${out.reason}`);
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "case_study.approval_requested", targetType: "case_study", targetId: id });
    return { ok: true, message: "Approval request sent." };
  }, { revalidate: ["/app/growth"] });
}

export async function publishCaseStudyAction(id: string, publish: boolean): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertFeature(ctx.entitlement, "case_study_generator");
    const cs = await q.one("select * from case_studies where id = $1", [id]);
    if (publish && !["approved", "published"].includes(cs.status)) throw new UserError("Only case studies approved by the client can be published.");
    const slug =
      cs.public_slug ??
      `${cs.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50).replace(/^-|-$/g, "")}-${randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6)}`;
    await q.exec(
      "update case_studies set status = $2, public_slug = $3, published_at = case when $2 = 'published' then now() end, updated_at = now() where id = $1",
      [id, publish ? "published" : "approved", slug],
    );
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: publish ? "case_study.published" : "case_study.unpublished", targetType: "case_study", targetId: id });
    return { ok: true, message: publish ? "Published." : "Unpublished." };
  }, { revalidate: ["/app/growth"] });
}

export async function deleteCaseStudyAction(id: string) {
  await tenantAction(async (_ctx, q) => {
    await q.exec("delete from case_studies where id = $1", [id]);
  }, { revalidate: ["/app/growth"] });
}

export async function generateReferralAction(clientId: string): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertFeature(ctx.entitlement, "referral_requests");
    const client = await q.one("select * from clients where id = $1", [clientId]);
    await maybeCountAi(q, ctx);
    const r = await generateReferralRequest(ctx.workspace, client, await latestSnapshot(q, client));
    return { ok: true, data: { subject: r.subject, body: r.body }, message: "Draft ready. Edit it below, then send." };
  });
}

export async function sendReferralAction(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    assertFeature(ctx.entitlement, "referral_requests");
    if (!ctx.user.email_verified_at) throw new UserError("Confirm your email address first.");
    const subject = str(fd, "subject");
    const body = str(fd, "body");
    if (!subject || !body) throw new UserError("Subject and message are required.");
    assertTone(body, { maxLength: 2000 });
    const recent = await q.maybe(
      "select 1 from message_log where client_id = $1 and kind = 'referral' and status = 'sent' and created_at > now() - interval '30 days'",
      [clientId],
    );
    if (recent && fd.get("force") !== "1") throw new UserError("You already asked this client for a referral in the last 30 days. Tick “send anyway” if you're sure.");
    const client = await q.one("select * from clients where id = $1", [clientId]);
    const out = await sendToClient(q, { workspace: ctx.workspace, client, ent: ctx.entitlement, channel: "email", kind: "referral", subject, bodyText: body });
    if (out.status !== "sent") throw new UserError(`Not sent: ${out.reason}`);
    return { ok: true, message: "Referral request sent." };
  }, { revalidate: ["/app/growth"] });
}
