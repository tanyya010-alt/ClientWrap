import { withService, type Q } from "./db";
import { resolveEntitlement, type Entitlement, can, limit, featureError, LimitError, PLANS, type Feature } from "./tiers";

export async function loadEntitlementQ(q: Q, userId: string): Promise<Entitlement> {
  const licenses = await q.many(
    "select license_key, tier, status, deactivated_at, superseded_by from licenses where user_id = $1",
    [userId],
  );
  const subscriptions = await q.many(
    "select plan, status, current_period_end from subscriptions where user_id = $1",
    [userId],
  );
  return resolveEntitlement({ licenses: licenses as any, subscriptions: subscriptions as any });
}

export function loadEntitlement(userId: string): Promise<Entitlement> {
  return withService((q) => loadEntitlementQ(q, userId));
}

export class ReadOnlyError extends LimitError {
  constructor() {
    super(
      "Your license is deactivated, so your data is read-only. You can still export everything. Apply a new license or choose a plan to continue.",
      "solo",
    );
  }
}

export function assertWritable(ent: Entitlement) {
  if (ent.mode !== "full") throw new ReadOnlyError();
}

export function assertFeature(ent: Entitlement, feature: Feature) {
  assertWritable(ent);
  if (!can(ent, feature)) throw featureError(feature);
}

export function currentPeriod(d = new Date()): string {
  return d.toISOString().slice(0, 7);
}

export type UsageMetric = "emails" | "webhook_events" | "ai_generations" | "sms";
const USAGE_LIMIT_KEY = {
  emails: "emailsPerMonth",
  webhook_events: "webhookEventsPerMonth",
  ai_generations: "aiGenerationsPerMonth",
  sms: "smsPerMonth",
} as const;

export const USAGE_LABELS: Record<UsageMetric, string> = {
  emails: "Emails sent",
  webhook_events: "Webhook events",
  ai_generations: "AI generations",
  sms: "SMS / WhatsApp messages",
};

/** Atomically consumes fair-use quota; throws LimitError with an upgrade path when exceeded. */
export async function consumeUsage(q: Q, workspaceId: string, ent: Entitlement, metric: UsageMetric, n = 1) {
  const max = limit(ent, USAGE_LIMIT_KEY[metric]);
  const row = await q.maybe<{ count: number }>(
    `insert into usage_counters (workspace_id, period, metric, count) values ($1,$2,$3,$4)
     on conflict (workspace_id, period, metric) do update set count = usage_counters.count + $4
     where usage_counters.count + $4 <= $5
     returning count`,
    [workspaceId, currentPeriod(), metric, n, max],
  );
  if (!row || row.count > max) {
    const next = ent.plan === "free" ? "solo" : ent.plan === "solo" ? "growth" : ent.plan === "growth" ? "agency" : null;
    throw new LimitError(
      `You've reached this month's fair-use limit for ${USAGE_LABELS[metric].toLowerCase()} (${max} on ${PLANS[ent.plan].name}). It resets on the 1st.` +
        (next ? ` Upgrade to ${PLANS[next].name} for a higher limit.` : " Contact support if you need a temporary increase."),
      next,
    );
  }
}

export async function usageSnapshot(q: Q, workspaceId: string, ent: Entitlement) {
  const rows = await q.many<{ metric: UsageMetric; count: number }>(
    "select metric, count from usage_counters where workspace_id = $1 and period = $2",
    [workspaceId, currentPeriod()],
  );
  const clients = await q.one<{ n: number }>(
    "select count(*)::int as n from clients where workspace_id = $1 and not is_demo and archived_at is null",
    [workspaceId],
  );
  const used = Object.fromEntries(rows.map((r) => [r.metric, r.count])) as Record<string, number>;
  return {
    clients: { used: clients.n, max: limit(ent, "clients") },
    ...(Object.fromEntries(
      (Object.keys(USAGE_LIMIT_KEY) as UsageMetric[]).map((m) => [m, { used: used[m] ?? 0, max: limit(ent, USAGE_LIMIT_KEY[m]) }]),
    ) as Record<UsageMetric, { used: number; max: number }>),
  };
}
