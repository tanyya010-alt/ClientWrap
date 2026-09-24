"use server";

import { redirect } from "next/navigation";
import { tenantAction, str, optStr, UserError } from "@/lib/actions";
import type { ActionState } from "@/lib/action-types";
import { isValidTimeZone } from "@/lib/time";
import { SERVICE_TEMPLATES, getTemplate } from "@/lib/templates";
import { fileToDataUrl, createClient } from "@/lib/clients";
import { cleanEvent, insertEvents, type CleanEvent } from "@/lib/metrics";
import { loadDemoWorkspace, seedClientHistory } from "@/lib/demo";
import { generateReport, sendReport } from "@/lib/report-service";
import { audit } from "@/lib/audit";
import { assertWritable } from "@/lib/entitlements";

function go(step: number) {
  redirect(`/onboarding?step=${step}`);
}

export async function aboutAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction(async (ctx, q) => {
    const name = str(fd, "name");
    const st = str(fd, "service_type");
    const tz = str(fd, "timezone");
    if (!name) throw new UserError("What's your business called?");
    if (!SERVICE_TEMPLATES.some((t) => t.key === st)) throw new UserError("Pick the closest service type.");
    if (!isValidTimeZone(tz)) throw new UserError("Pick a timezone.");
    await q.exec("update workspaces set name=$2, service_type=$3, timezone=$4, currency=$5, reply_to_email=coalesce(reply_to_email,$6), onboarding_step=greatest(onboarding_step,2) where id=$1", [
      ctx.workspace.id, name, st, tz, str(fd, "currency") || "USD", ctx.user.email,
    ]);
  });
  if (r?.error) return r;
  go(2);
  return null;
}

export async function brandAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction(async (ctx, q) => {
    const color = str(fd, "brand_color");
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new UserError("Pick a color.");
    const logo = await fileToDataUrl(fd.get("logo") as File | null);
    await q.exec("update workspaces set brand_color=$2, accent_color=$2, logo_data=coalesce($3, logo_data), onboarding_step=greatest(onboarding_step,3) where id=$1", [ctx.workspace.id, color, logo]);
  });
  if (r?.error) return r;
  go(3);
  return null;
}

export async function firstClientAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction(async (ctx, q) => {
    assertWritable(ctx.entitlement);
    const name = str(fd, "name");
    if (!name) throw new UserError("Client name is required.");
    const email = optStr(fd, "contact_email");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError("Enter a valid email.");
    const existing = await q.maybe("select id from clients where not is_demo order by created_at limit 1");
    if (existing) {
      await q.exec("update clients set name=$2, contact_name=$3, contact_email=$4 where id=$1", [existing.id, name, optStr(fd, "contact_name"), email]);
    } else {
      await createClient(q, ctx.workspace.id, ctx.entitlement, { name, contactName: optStr(fd, "contact_name"), contactEmail: email, timezone: ctx.workspace.timezone, template: ctx.workspace.service_type });
    }
    await q.exec("update workspaces set onboarding_step=greatest(onboarding_step,4) where id=$1", [ctx.workspace.id]);
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "onboarding.client_added" });
  });
  if (r?.error) return r;
  go(4);
  return null;
}

export async function resultsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction(async (ctx, q) => {
    const client = await q.one("select * from clients where not is_demo order by created_at limit 1");
    if (fd.get("sample") === "1") {
      await seedClientHistory(q, ctx.workspace.id, client.id, ctx.workspace.service_type, 3, 5);
    } else {
      const events: CleanEvent[] = [];
      const errors: string[] = [];
      for (const [k, v] of fd.entries()) {
        const m = k.match(/^(cur|prev)__(.+)$/);
        if (!m || typeof v !== "string" || !v.trim()) continue;
        const date = m[1] === "cur" ? str(fd, "cur_date") : str(fd, "prev_date");
        const cfg = (client.metric_config ?? {})[m[2]] ?? {};
        const res = cleanEvent({ metric: m[2], value: v, unit: cfg.unit ?? "", timestamp: date, idempotency_key: `onboarding:${m[2]}:${date}` });
        if (res.ok) events.push(res.event);
        else errors.push(`${cfg.label ?? m[2]}: ${res.error}`);
      }
      if (errors.length) throw new UserError(errors.join(" · "));
      if (events.length === 0) throw new UserError("Enter at least one number, or use sample numbers.");
      await insertEvents(q, ctx.workspace.id, client.id, events, "manual");
    }
    await q.exec("update workspaces set onboarding_step=greatest(onboarding_step,5) where id=$1", [ctx.workspace.id]);
  });
  if (r?.error) return r;
  go(5);
  return null;
}

export async function generateFirstAction(period: string): Promise<ActionState> {
  const r = await tenantAction(async (ctx, q) => {
    const client = await q.one("select * from clients where not is_demo order by created_at limit 1");
    await generateReport(q, ctx.workspace, ctx.entitlement, client, period);
  });
  if (r?.error) return r;
  go(5);
  return null;
}

export async function sendFirstAction(reportId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await tenantAction(async (ctx, q) => {
    if (!ctx.user.email_verified_at) throw new UserError(`Confirm your email first: we sent a link to ${ctx.user.email}. Then click send again.`);
    const narrative = fd.get("narrative");
    if (typeof narrative === "string") {
      await q.exec("update reports set narrative = $2, next_step = $3 where id = $1", [reportId, narrative.slice(0, 8000), str(fd, "next_step").slice(0, 2000)]);
    }
    const toMe = fd.get("to") === "me";
    const out = await sendReport(q, ctx.workspace, ctx.entitlement, reportId, ctx.user.id, toMe ? { to: ctx.user.email } : {});
    if (out.status !== "sent") throw new UserError(`Not sent: ${out.reason}`);
    await q.exec("update workspaces set onboarding_step=6, onboarding_completed_at=coalesce(onboarding_completed_at, now()) where id=$1", [ctx.workspace.id]);
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "onboarding.completed", metadata: { toMe } });
  });
  if (r?.error) return r;
  redirect("/onboarding?step=6");
  return null;
}

export async function loadDemoAction(): Promise<ActionState> {
  const r = await tenantAction(async (ctx, q) => {
    await loadDemoWorkspace(q, ctx.workspace);
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "demo.loaded" });
  }, { revalidate: ["/app"] });
  if (r?.error) return r;
  redirect("/app?demo=1");
  return null;
}

export async function removeDemoAction(): Promise<ActionState> {
  return tenantAction(async (ctx, q) => {
    await q.exec("delete from clients where is_demo");
    await audit(q, { workspaceId: ctx.workspace.id, userId: ctx.user.id, action: "demo.removed" });
    return { ok: true, message: "Demo data removed." };
  }, { revalidate: ["/app"] });
}

export async function skipOnboardingAction() {
  await tenantAction(async (ctx, q) => {
    await q.exec("update workspaces set onboarding_completed_at = coalesce(onboarding_completed_at, now()) where id = $1", [ctx.workspace.id]);
  });
  redirect("/app");
}


