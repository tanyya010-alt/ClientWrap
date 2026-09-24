import { withService, withTenant } from "./db";
import { decryptOrNull, hmacHex, safeEqual, sha256 } from "./crypto";
import { cleanEvent, insertEvents, type CleanEvent } from "./metrics";
import { loadEntitlementQ, consumeUsage } from "./entitlements";
import { can, LimitError } from "./tiers";

export interface IngestResult {
  status: number;
  body: Record<string, unknown>;
}

export function signIngest(secret: string, timestamp: string, rawBody: string): string {
  return `sha256=${hmacHex(secret, `${timestamp}.${rawBody}`)}`;
}

/**
 * Per-client metrics webhook.
 * Auth: X-ClientWrap-Signature = "sha256=" + hex(HMAC_SHA256(secret, `${X-ClientWrap-Timestamp}.${rawBody}`))
 *       (timestamp in unix seconds, must be within 5 minutes), or "Authorization: Bearer <secret>" for tools
 *       that cannot compute HMACs.
 * Body: {metric, value, unit?, timestamp?, idempotency_key?} or {events: [...]} (max 500).
 * Idempotency: Idempotency-Key header (single event) or idempotency_key per event.
 */
export async function handleIngest(publicToken: string, rawBody: string, headers: Headers, now = Date.now()): Promise<IngestResult> {
  const hook = await withService((q) =>
    q.maybe(
      `select h.*, w.owner_id from webhook_secrets h join workspaces w on w.id = h.workspace_id
       where h.public_token = $1 and h.revoked_at is null`,
      [publicToken],
    ),
  );
  if (!hook) return { status: 404, body: { error: "Unknown or revoked webhook URL" } };
  const secret = decryptOrNull(hook.secret_enc);
  if (!secret) return { status: 500, body: { error: "Webhook secret unavailable" } };

  const sig = headers.get("x-clientwrap-signature");
  const ts = headers.get("x-clientwrap-timestamp");
  const bearer = headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  let authed = false;
  if (sig) {
    if (!ts || !/^\d+$/.test(ts)) return { status: 401, body: { error: "Missing X-ClientWrap-Timestamp (unix seconds)" } };
    const tsMs = Number(ts) < 1e12 ? Number(ts) * 1000 : Number(ts);
    if (Math.abs(now - tsMs) > 5 * 60_000) return { status: 401, body: { error: "Timestamp is more than 5 minutes off; check the sender's clock" } };
    authed = safeEqual(sig.trim(), signIngest(secret, ts, rawBody));
    if (!authed) return { status: 401, body: { error: "Invalid signature" } };
  } else if (bearer) {
    authed = safeEqual(sha256(bearer), sha256(secret));
    if (!authed) return { status: 401, body: { error: "Invalid secret" } };
  } else {
    return { status: 401, body: { error: "Missing X-ClientWrap-Signature or Authorization header" } };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "Body must be valid JSON" } };
  }
  const list: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.events) ? parsed.events : [parsed];
  if (list.length === 0) return { status: 400, body: { error: "No events in body" } };
  if (list.length > 500) return { status: 413, body: { error: "At most 500 events per request" } };
  const headerKey = headers.get("idempotency-key");
  const events: CleanEvent[] = [];
  const errors: { index: number; error: string }[] = [];
  list.forEach((raw, index) => {
    const withKey =
      raw && typeof raw === "object" && headerKey && list.length === 1 && !(raw as any).idempotency_key
        ? { ...(raw as object), idempotency_key: headerKey }
        : raw;
    const r = cleanEvent(withKey);
    if (r.ok) events.push({ ...r.event, idempotencyKey: r.event.idempotencyKey ? `wh:${r.event.idempotencyKey}` : null });
    else errors.push({ index, error: r.error });
  });
  if (events.length === 0) return { status: 400, body: { error: "No valid events", errors } };

  try {
    const result = await withTenant({ userId: hook.owner_id, workspaceId: hook.workspace_id }, async (q) => {
      const ent = await withService((sq) => loadEntitlementQ(sq, hook.owner_id));
      if (ent.mode !== "full") throw new LimitError("This account is read-only; new data is not accepted.", "solo");
      if (!can(ent, "metrics_webhook")) throw new LimitError("The metrics webhook is available on the Solo plan and above.", "solo");
      await consumeUsage(q, hook.workspace_id, ent, "webhook_events", events.length);
      const r = await insertEvents(q, hook.workspace_id, hook.client_id, events, "webhook");
      await q.exec("update webhook_secrets set last_used_at = now() where id = $1", [hook.id]);
      return r;
    });
    return { status: 200, body: { ok: true, accepted: result.inserted, duplicates: result.duplicates, rejected: errors.length, errors } };
  } catch (e) {
    if (e instanceof LimitError) return { status: 402, body: { error: e.message } };
    throw e;
  }
}
