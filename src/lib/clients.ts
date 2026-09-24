import type { Q } from "./db";
import { LimitError, PLANS, type Entitlement, limit } from "./tiers";
import { assertWritable } from "./entitlements";
import { getTemplate, metricConfigFromTemplate } from "./templates";
import { ensurePortalLink } from "./portal";

export async function assertClientCapacity(q: Q, ent: Entitlement) {
  assertWritable(ent);
  const max = limit(ent, "clients");
  const n = await q.one<{ n: number }>("select count(*)::int as n from clients where not is_demo and archived_at is null");
  if (n.n >= max) {
    const next = ent.plan === "free" ? "solo" : ent.plan === "solo" ? "growth" : ent.plan === "growth" ? "agency" : null;
    throw new LimitError(
      `You're using all ${max} client workspace${max === 1 ? "" : "s"} on the ${PLANS[ent.plan].name} plan. Archive a client${next ? ` or upgrade to ${PLANS[next].name} (${PLANS[next].limits.clients} clients)` : ""} to add more.`,
      next,
    );
  }
}

export async function createClient(
  q: Q,
  workspaceId: string,
  ent: Entitlement,
  input: { name: string; contactName?: string | null; contactEmail?: string | null; contactPhone?: string | null; timezone?: string | null; template?: string | null; monthlyFeeCents?: number | null; isDemo?: boolean },
) {
  if (!input.isDemo) await assertClientCapacity(q, ent);
  const t = getTemplate(input.template);
  const client = await q.one(
    `insert into clients (workspace_id, name, contact_name, contact_email, contact_phone, timezone, service_description, metric_config, monthly_fee_cents, is_demo, report_day)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
    [
      workspaceId,
      input.name,
      input.contactName ?? null,
      input.contactEmail ?? null,
      input.contactPhone ?? null,
      input.timezone ?? null,
      t.serviceDescription,
      JSON.stringify(metricConfigFromTemplate(t)),
      input.monthlyFeeCents ?? null,
      Boolean(input.isDemo),
      null,
    ],
  );
  await ensurePortalLink(q, workspaceId, client.id);
  return client;
}

export async function fileToDataUrl(file: File | null, maxBytes = 300_000): Promise<string | null> {
  if (!file || file.size === 0) return null;
  if (!["image/png", "image/jpeg"].includes(file.type)) throw new Error("Logo must be a PNG or JPEG image.");
  if (file.size > maxBytes) throw new Error(`Logo must be under ${Math.round(maxBytes / 1000)} KB.`);
  const buf = Buffer.from(await file.arrayBuffer());
  return `data:${file.type};base64,${buf.toString("base64")}`;
}
