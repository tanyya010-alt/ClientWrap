import type { Q } from "./db";
import { hmacHex, safeEqual, sha256 } from "./crypto";
import { env } from "./env";
import { audit } from "./audit";
import { REFUND_REPURCHASE_BLOCK_HOURS, planForAppsumoTier, PLANS } from "./tiers";

/**
 * AppSumo Licensing API v2.
 *  - Webhook: POST JSON, headers X-Appsumo-Timestamp + X-Appsumo-Signature,
 *    signature = hex(HMAC-SHA256(key = APPSUMO_API_KEY, message = timestamp + rawBody)).
 *  - OAuth: user clicks "Activate" on AppSumo -> redirected to /api/appsumo/oauth?code=...
 *    We exchange the code for an access token and fetch the license key.
 * License rows are only ever created or changed by applyLicenseEvent(), which is only called with
 * AppSumo webhook payloads (or the refund CSV reconciliation, which replays a "deactivate").
 */

export const APPSUMO_EVENTS = ["purchase", "activate", "upgrade", "downgrade", "deactivate", "migrate"] as const;
export type AppsumoEvent = (typeof APPSUMO_EVENTS)[number];

export interface AppsumoPayload {
  license_key: string;
  prev_license_key?: string | null;
  plan_id?: string | null;
  event: AppsumoEvent | string;
  event_timestamp?: number | string | null;
  created_at?: number | string | null;
  license_status?: string | null;
  tier?: number | string | null;
  test?: boolean;
  extra?: { reason?: string | null } & Record<string, unknown>;
}

export function verifyAppsumoSignature(rawBody: string, timestamp: string | null, signature: string | null, apiKey = env.APPSUMO_API_KEY): boolean {
  if (!apiKey || !timestamp || !signature) return false;
  const expected = hmacHex(apiKey, `${timestamp}${rawBody}`);
  return safeEqual(expected, signature.trim().toLowerCase());
}

/** Rejects signatures older than 5 minutes (timestamps are in ms or s). */
export function timestampFresh(timestamp: string | null, now = Date.now(), toleranceMs = 5 * 60_000): boolean {
  if (!timestamp) return false;
  let t = Number(timestamp);
  if (!Number.isFinite(t)) return false;
  if (t < 1e12) t *= 1000;
  return Math.abs(now - t) <= toleranceMs;
}

export function eventDedupeHash(p: AppsumoPayload): string {
  return sha256(
    [p.event, p.license_key, p.prev_license_key ?? "", p.event_timestamp ?? p.created_at ?? "", p.tier ?? "", p.license_status ?? ""].join("|"),
  );
}

function tierOf(p: AppsumoPayload, fallback = 1): number {
  const n = Number(p.tier ?? NaN);
  if (Number.isFinite(n) && n >= 1) return Math.min(Math.floor(n), 3);
  // plan_id like "clientwrap_tier2"
  const m = String(p.plan_id ?? "").match(/(\d+)\s*$/);
  return m ? Math.min(Math.max(Number(m[1]), 1), 3) : fallback;
}

function tsOf(p: AppsumoPayload): Date {
  const v = p.event_timestamp ?? p.created_at;
  if (v === undefined || v === null || v === "") return new Date();
  const n = Number(v);
  if (Number.isFinite(n)) return new Date(n < 1e12 ? n * 1000 : n);
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export interface RecordResult {
  duplicate: boolean;
  eventId: string;
}

/** Stores the raw payload (always) and returns whether it was already processed. */
export async function recordLicenseEvent(
  q: Q,
  payload: AppsumoPayload,
  source: "webhook" | "oauth" | "csv_reconciliation" | "redeem",
  signature: string | null,
): Promise<RecordResult> {
  const hash = source === "webhook" ? eventDedupeHash(payload) : sha256(`${source}|${JSON.stringify(payload)}|${Date.now()}|${Math.random()}`);
  const inserted = await q.maybe<{ id: string }>(
    `insert into license_events (license_key, event, source, payload, signature, dedupe_hash)
     values ($1,$2,$3,$4,$5,$6) on conflict (dedupe_hash) do nothing returning id`,
    [payload.license_key ?? "", String(payload.event ?? ""), source, JSON.stringify(payload), signature, hash],
  );
  if (inserted) return { duplicate: false, eventId: inserted.id };
  const existing = await q.one<{ id: string; processed_at: Date | null }>("select id, processed_at from license_events where dedupe_hash = $1", [hash]);
  return { duplicate: existing.processed_at !== null, eventId: existing.id };
}

async function attachPending(q: Q, licenseKey: string) {
  const pending = await q.maybe<{ user_id: string }>("delete from pending_redemptions where license_key = $1 returning user_id", [licenseKey]);
  if (pending) {
    const lic = await q.one("select * from licenses where license_key = $1", [licenseKey]);
    if (!lic.user_id && lic.status !== "deactivated") {
      await q.exec("update licenses set user_id = $2, redeemed_at = now(), updated_at = now() where license_key = $1", [licenseKey, pending.user_id]);
    }
  }
}

async function workspaceOf(q: Q, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const ws = await q.maybe<{ id: string }>("select id from workspaces where owner_id = $1 order by created_at limit 1", [userId]);
  return ws?.id ?? null;
}

/** The license state machine. Idempotent: replaying the same event leaves the same state. */
export async function applyLicenseEvent(q: Q, p: AppsumoPayload, actor: "appsumo" | "system" = "appsumo") {
  const key = String(p.license_key ?? "").trim();
  if (!key) throw new Error("license_key missing");
  const event = String(p.event) as AppsumoEvent;
  if (!APPSUMO_EVENTS.includes(event)) throw new Error(`unknown event: ${p.event}`);
  const at = tsOf(p);
  const existing = await q.maybe("select * from licenses where license_key = $1 for update", [key]);

  const upsert = async (fields: { tier: number; status: string; userId?: string | null; prevKey?: string | null }) => {
    await q.exec(
      `insert into licenses (license_key, tier, status, plan_id, prev_license_key, test, user_id, purchased_at, activated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8, case when $3 = 'active' then $8::timestamptz end)
       on conflict (license_key) do update set
         tier = excluded.tier,
         status = excluded.status,
         plan_id = coalesce(excluded.plan_id, licenses.plan_id),
         prev_license_key = coalesce(excluded.prev_license_key, licenses.prev_license_key),
         user_id = coalesce(licenses.user_id, excluded.user_id),
         activated_at = case when excluded.status = 'active' then coalesce(licenses.activated_at, excluded.activated_at) else licenses.activated_at end,
         deactivated_at = case when excluded.status = 'active' then null else licenses.deactivated_at end,
         deactivation_reason = case when excluded.status = 'active' then null else licenses.deactivation_reason end,
         superseded_by = case when excluded.status = 'active' then null else licenses.superseded_by end,
         updated_at = now()`,
      [key, fields.tier, fields.status, p.plan_id ?? null, fields.prevKey ?? null, Boolean(p.test), fields.userId ?? null, at],
    );
    await attachPending(q, key);
  };

  switch (event) {
    case "purchase": {
      // A purchase never downgrades an already-active license's status.
      const status = existing?.status === "active" ? "active" : p.license_status === "active" ? "active" : "inactive";
      await upsert({ tier: tierOf(p, existing?.tier ?? 1), status });
      break;
    }
    case "activate": {
      await upsert({ tier: tierOf(p, existing?.tier ?? 1), status: "active" });
      break;
    }
    case "upgrade":
    case "downgrade":
    case "migrate": {
      const prevKey = p.prev_license_key ? String(p.prev_license_key) : null;
      let userId: string | null = null;
      if (prevKey && prevKey !== key) {
        const prev = await q.maybe("select * from licenses where license_key = $1 for update", [prevKey]);
        userId = prev?.user_id ?? null;
        if (prev) {
          await q.exec(
            `update licenses set status = 'deactivated', superseded_by = $2, deactivated_at = coalesce(deactivated_at, $3),
               deactivation_reason = $4, updated_at = now() where license_key = $1`,
            [prevKey, key, at, event],
          );
        }
        // If the old key had a pending redemption, carry it to the new key.
        await q.exec("update pending_redemptions set license_key = $2 where license_key = $1", [prevKey, key]);
      }
      const status = p.license_status === "inactive" ? "inactive" : p.license_status === "deactivated" ? "deactivated" : "active";
      await upsert({ tier: tierOf(p, existing?.tier ?? 1), status, userId, prevKey });
      break;
    }
    case "deactivate": {
      const reason = String(p.extra?.reason ?? "deactivated");
      // AppSumo only deactivates a license when the purchase is refunded, so every deactivation
      // counts as a refund for the re-purchase cooldown. The reason string is kept for support.
      const refunded = true;
      if (!existing) {
        await q.exec(
          `insert into licenses (license_key, tier, status, plan_id, test, deactivated_at, deactivation_reason, refunded)
           values ($1,$2,'deactivated',$3,$4,$5,$6,$7)`,
          [key, tierOf(p), p.plan_id ?? null, Boolean(p.test), at, reason, refunded],
        );
      } else {
        await q.exec(
          `update licenses set status = 'deactivated', deactivated_at = coalesce(deactivated_at, $2), deactivation_reason = $3,
             refunded = $4, updated_at = now() where license_key = $1`,
          [key, at, reason, refunded],
        );
        if (existing.user_id) {
          await q.exec(
            `update users set refund_block_until = greatest(coalesce(refund_block_until, now()), now() + make_interval(hours => $2)) where id = $1`,
            [existing.user_id, REFUND_REPURCHASE_BLOCK_HOURS],
          );
        }
      }
      await q.exec("delete from pending_redemptions where license_key = $1", [key]);
      break;
    }
  }

  const lic = await q.one("select * from licenses where license_key = $1", [key]);
  const wsId = await workspaceOf(q, lic.user_id);
  await audit(q, {
    workspaceId: wsId,
    userId: lic.user_id,
    actor: actor === "appsumo" ? "appsumo" : "system",
    action: `license.${event}`,
    targetType: "license",
    targetId: key,
    metadata: { tier: lic.tier, status: lic.status, prev_license_key: p.prev_license_key ?? null },
  });
  return lic;
}

export class RedeemError extends Error {}

/**
 * Links an AppSumo license to a ClientWrap account. This does not change license status/tier
 * (that only comes from webhooks); it records who owns the license.
 */
export async function redeemLicense(q: Q, userId: string, licenseKeyRaw: string, via: "oauth" | "manual"): Promise<{ status: "redeemed" | "pending"; plan?: string }> {
  const licenseKey = licenseKeyRaw.trim();
  if (!licenseKey || licenseKey.length > 200) throw new RedeemError("Enter your AppSumo license key.");
  const user = await q.one("select * from users where id = $1", [userId]);
  if (user.refund_block_until && new Date(user.refund_block_until) > new Date()) {
    throw new RedeemError(
      `A license on this account was refunded recently. You can redeem a new license after ${new Date(user.refund_block_until).toUTCString()}.`,
    );
  }
  const lic = await q.maybe("select * from licenses where license_key = $1 for update", [licenseKey]);
  if (!lic) {
    if (via === "oauth") {
      // AppSumo confirmed this key belongs to the user; wait for the webhook to create it.
      await q.exec(
        `insert into pending_redemptions (license_key, user_id) values ($1,$2)
         on conflict (license_key) do update set user_id = excluded.user_id, created_at = now()`,
        [licenseKey, userId],
      );
      await recordLicenseEvent(q, { license_key: licenseKey, event: "redeem_pending", extra: { user_id: userId } } as any, "redeem", null);
      return { status: "pending" };
    }
    throw new RedeemError(
      "We couldn't find that license yet. If you just bought it, wait a minute and try again, or use the Activate button on AppSumo.",
    );
  }
  if (lic.user_id && lic.user_id !== userId) throw new RedeemError("This license is already linked to another ClientWrap account.");
  if (lic.status === "deactivated") {
    throw new RedeemError(
      lic.superseded_by
        ? "This license was replaced by an upgraded or downgraded license. Use the new license key from AppSumo."
        : "This license has been deactivated (for example after a refund) and can't be redeemed.",
    );
  }
  if (lic.user_id !== userId) {
    await q.exec("update licenses set user_id = $2, redeemed_at = now(), updated_at = now() where license_key = $1", [licenseKey, userId]);
  }
  await recordLicenseEvent(q, { license_key: licenseKey, event: "redeem", extra: { user_id: userId, via } } as any, "redeem", null);
  const wsId = await workspaceOf(q, userId);
  await audit(q, { workspaceId: wsId, userId, action: "license.redeemed", targetType: "license", targetId: licenseKey, metadata: { via } });
  return { status: "redeemed", plan: PLANS[planForAppsumoTier(lic.tier)].name };
}

// ------------------------------------------------------------------ OAuth

export function appsumoRedirectUri(): string {
  return `${env.APP_URL}/api/appsumo/oauth`;
}

export async function exchangeAppsumoCode(code: string): Promise<{ licenseKey: string; email: string | null }> {
  if (!env.APPSUMO_CLIENT_ID || !env.APPSUMO_CLIENT_SECRET) throw new Error("AppSumo OAuth is not configured");
  const tokenRes = await fetch(`${env.APPSUMO_BASE_URL}/openid/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.APPSUMO_CLIENT_ID,
      client_secret: env.APPSUMO_CLIENT_SECRET,
      code,
      redirect_uri: appsumoRedirectUri(),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const token = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; id_token?: string; error?: string };
  if (!tokenRes.ok || !token.access_token) throw new Error(`AppSumo token exchange failed: ${token.error ?? tokenRes.status}`);
  const licRes = await fetch(`${env.APPSUMO_BASE_URL}/openid/license_key/?access_token=${encodeURIComponent(token.access_token)}`, {
    signal: AbortSignal.timeout(15_000),
  });
  const lic = (await licRes.json().catch(() => ({}))) as { license_key?: string };
  if (!licRes.ok || !lic.license_key) throw new Error("AppSumo did not return a license key");
  let email: string | null = null;
  if (token.id_token) {
    // Only used to pre-fill the signup form; never trusted for authorization.
    try {
      const claims = JSON.parse(Buffer.from(token.id_token.split(".")[1], "base64url").toString("utf8"));
      email = typeof claims.email === "string" ? claims.email : null;
    } catch {
      email = null;
    }
  }
  return { licenseKey: lic.license_key, email };
}

// ------------------------------------------------------------------ Refund CSV reconciliation

export interface ReconcileSummary {
  rows: number;
  refunded: number;
  revoked: number;
  alreadyRevoked: number;
  unknownKeys: string[];
  redeemedNotLinked: string[];
  errors: string[];
}

function pickColumn(headers: string[], ...patterns: RegExp[]): string | undefined {
  for (const p of patterns) {
    const h = headers.find((x) => p.test(x));
    if (h) return h;
  }
  return undefined;
}

/**
 * Imports AppSumo's refunded/redeemed codes export. For each refunded row, replays a "deactivate"
 * through the same state machine as the webhook (revoking access and starting the 24h re-purchase block).
 */
export async function reconcileAppsumoCsv(q: Q, rows: Record<string, string>[], headers: string[]): Promise<ReconcileSummary> {
  const keyCol = pickColumn(headers, /license.?key/i, /^code$/i, /code/i, /key/i);
  const statusCol = pickColumn(headers, /status/i, /state/i);
  const refundCol = pickColumn(headers, /refund/i);
  if (!keyCol) throw new Error(`Could not find a license key / code column in: ${headers.join(", ")}`);
  const s: ReconcileSummary = { rows: rows.length, refunded: 0, revoked: 0, alreadyRevoked: 0, unknownKeys: [], redeemedNotLinked: [], errors: [] };
  for (const row of rows) {
    const key = (row[keyCol] ?? "").trim();
    if (!key) continue;
    const status = (statusCol ? row[statusCol] : "").toLowerCase();
    const refundVal = (refundCol ? row[refundCol] : "").toLowerCase();
    const isRefunded = /refund/.test(status) || (refundCol !== undefined && refundCol !== statusCol && refundVal !== "" && !/^(no|false|0|n\/a)$/.test(refundVal));
    try {
      const lic = await q.maybe("select * from licenses where license_key = $1", [key]);
      if (isRefunded) {
        s.refunded++;
        if (lic?.status === "deactivated" && !lic.superseded_by) {
          s.alreadyRevoked++;
          continue;
        }
        const payload: AppsumoPayload = {
          license_key: key,
          event: "deactivate",
          license_status: "deactivated",
          tier: lic?.tier ?? 1,
          event_timestamp: Date.now(),
          extra: { reason: "refund (csv reconciliation)" },
        };
        await recordLicenseEvent(q, payload, "csv_reconciliation", null);
        await applyLicenseEvent(q, payload, "system");
        s.revoked++;
      } else if (/redeem|activ/.test(status)) {
        if (!lic) s.unknownKeys.push(key);
        else if (!lic.user_id) s.redeemedNotLinked.push(key);
      }
    } catch (e) {
      s.errors.push(`${key}: ${(e as Error).message}`);
    }
  }
  return s;
}

// ------------------------------------------------------------------ Webhook entry point

export async function handleAppsumoWebhook(rawBody: string, headers: Headers, now = Date.now()): Promise<{ status: number; body: Record<string, unknown> }> {
  const { withService } = await import("./db");
  const ts = headers.get("x-appsumo-timestamp");
  const sig = headers.get("x-appsumo-signature");
  if (!verifyAppsumoSignature(rawBody, ts, sig)) return { status: 401, body: { success: false, error: "invalid signature" } };
  if (!timestampFresh(ts, now)) return { status: 401, body: { success: false, error: "stale timestamp" } };
  let payload: AppsumoPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { success: false, error: "invalid json" } };
  }
  const event = String(payload?.event ?? "");
  if (!payload?.license_key || !APPSUMO_EVENTS.includes(event as AppsumoEvent)) {
    // Store it anyway for support, but tell AppSumo it was malformed.
    await withService((q) => recordLicenseEvent(q, { ...payload, license_key: payload?.license_key ?? "" } as AppsumoPayload, "webhook", sig));
    return { status: 400, body: { success: false, error: "unsupported payload" } };
  }
  const rec = await withService((q) => recordLicenseEvent(q, payload, "webhook", sig));
  if (rec.duplicate) return { status: 200, body: { success: true, event, duplicate: true } };
  if (payload.test) {
    await withService((q) => q.exec("update license_events set processed_at = now() where id = $1", [rec.eventId]));
    return { status: 200, body: { success: true, event, test: true } };
  }
  try {
    await withService(async (q) => {
      await applyLicenseEvent(q, payload, "appsumo");
      await q.exec("update license_events set processed_at = now(), error = null where id = $1", [rec.eventId]);
    });
  } catch (e) {
    await withService((q) => q.exec("update license_events set error = $2 where id = $1", [rec.eventId, (e as Error).message]));
    throw e;
  }
  return { status: 200, body: { success: true, event } };
}
