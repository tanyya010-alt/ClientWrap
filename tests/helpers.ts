import { randomUUID } from "node:crypto";
import { withService, withTenant, type Row } from "@/lib/db";
import { createUserWithWorkspace } from "@/lib/auth";
import { applyLicenseEvent } from "@/lib/appsumo";
import { hmacHex } from "@/lib/crypto";

export async function makeAccount(opts: { tier?: number; name?: string } = {}) {
  const email = `u-${randomUUID().slice(0, 8)}@example.com`;
  const { user, workspace } = await withService((q) => createUserWithWorkspace(q, { email, name: opts.name ?? "Test User", password: "password123", verified: true }));
  let licenseKey: string | null = null;
  if (opts.tier) {
    licenseKey = `lk-${randomUUID()}`;
    await withService(async (q) => {
      await applyLicenseEvent(q, { license_key: licenseKey!, event: "purchase", tier: opts.tier, license_status: "inactive" });
      await applyLicenseEvent(q, { license_key: licenseKey!, event: "activate", tier: opts.tier, license_status: "active" });
      await q.exec("update licenses set user_id = $2 where license_key = $1", [licenseKey, user.id]);
    });
  }
  return { user, workspace, licenseKey, ctx: { userId: user.id, workspaceId: workspace.id } };
}

export async function makeClient(ctx: { userId: string; workspaceId: string }, extra: Partial<Row> = {}) {
  return withTenant(ctx, (q) =>
    q.one(
      `insert into clients (workspace_id, name, contact_name, contact_email, contact_phone, timezone, metric_config)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [ctx.workspaceId, extra.name ?? "Acme Co", "Jane Doe", extra.contact_email ?? "jane@acme.test", extra.contact_phone ?? "+15555550100", extra.timezone ?? "UTC",
        JSON.stringify(extra.metric_config ?? { leads: { label: "Leads", unit: "leads", agg: "sum", better: "up" } })],
    ),
  );
}

export function appsumoHeaders(body: string, apiKey = "test-appsumo-api-key", ts = String(Date.now())) {
  return new Headers({
    "content-type": "application/json",
    "x-appsumo-timestamp": ts,
    "x-appsumo-signature": hmacHex(apiKey, `${ts}${body}`),
  });
}
