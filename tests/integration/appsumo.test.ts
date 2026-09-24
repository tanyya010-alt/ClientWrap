import { describe, expect, it, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { handleAppsumoWebhook, redeemLicense, exchangeAppsumoCode, reconcileAppsumoCsv, RedeemError } from "@/lib/appsumo";
import { withService, withTenant } from "@/lib/db";
import { loadEntitlement, assertWritable, ReadOnlyError } from "@/lib/entitlements";
import { exportWorkspaceData } from "@/lib/export";
import { cleanupExpiredLicenses } from "@/lib/jobs/handlers";
import { parseCsv } from "@/lib/metrics";
import { appsumoHeaders, makeAccount, makeClient } from "../helpers";

async function send(payload: Record<string, unknown>, opts: { key?: string; ts?: string } = {}) {
  const body = JSON.stringify({ event_timestamp: Date.now(), ...payload });
  return handleAppsumoWebhook(body, appsumoHeaders(body, opts.key, opts.ts));
}

const license = (key: string) => withService((q) => q.maybe("select * from licenses where license_key = $1", [key]));
const newKey = () => `as-${randomUUID()}`;

describe("AppSumo webhook: security & storage", () => {
  it("rejects a bad signature and stale timestamps", async () => {
    const r = await send({ event: "purchase", license_key: newKey(), tier: 1 }, { key: "wrong-key" });
    expect(r.status).toBe(401);
    const old = await send({ event: "purchase", license_key: newKey(), tier: 1 }, { ts: String(Date.now() - 3_600_000) });
    expect(old.status).toBe(401);
  });

  it("stores every payload and is idempotent on replays", async () => {
    const key = newKey();
    const body = JSON.stringify({ event: "purchase", license_key: key, tier: 1, license_status: "inactive", event_timestamp: 1790000000000 });
    const h = appsumoHeaders(body);
    const a = await handleAppsumoWebhook(body, h);
    const b = await handleAppsumoWebhook(body, appsumoHeaders(body));
    expect(a).toEqual({ status: 200, body: { success: true, event: "purchase" } });
    expect(b.body).toMatchObject({ success: true, duplicate: true });
    const events = await withService((q) => q.many("select * from license_events where license_key = $1", [key]));
    expect(events).toHaveLength(1);
    expect(events[0].payload.license_key).toBe(key);
    expect(events[0].processed_at).not.toBeNull();
  });

  it("acknowledges AppSumo test webhooks without changing licenses", async () => {
    const key = newKey();
    const r = await send({ event: "purchase", license_key: key, tier: 1, test: true });
    expect(r.body).toMatchObject({ success: true, test: true });
    expect(await license(key)).toBeNull();
  });
});

describe("AppSumo lifecycle (every event)", () => {
  it("purchase -> redeem (new user signs up, applies key) -> activate -> correct limits", async () => {
    const key = newKey();
    expect((await send({ event: "purchase", license_key: key, tier: 1, license_status: "inactive" })).status).toBe(200);
    expect(await license(key)).toMatchObject({ status: "inactive", tier: 1, user_id: null });

    const { user } = await makeAccount();
    await withService((q) => redeemLicense(q, user.id, key, "manual"));
    expect((await loadEntitlement(user.id)).plan).toBe("free"); // inactive until activated

    expect((await send({ event: "activate", license_key: key, tier: 1, license_status: "active" })).status).toBe(200);
    const ent = await loadEntitlement(user.id);
    expect(ent).toMatchObject({ plan: "solo", source: "appsumo", mode: "full" });
  });

  it("existing user logs in and applies a key; a key can't be claimed twice", async () => {
    const key = newKey();
    await send({ event: "purchase", license_key: key, tier: 2, license_status: "active" });
    await send({ event: "activate", license_key: key, tier: 2, license_status: "active" });
    const a = await makeAccount();
    const b = await makeAccount();
    await withService((q) => redeemLicense(q, a.user.id, key, "manual"));
    expect((await loadEntitlement(a.user.id)).plan).toBe("growth");
    await expect(withService((q) => redeemLicense(q, b.user.id, key, "manual"))).rejects.toThrow(/another ClientWrap account/);
    await expect(withService((q) => redeemLicense(q, b.user.id, "does-not-exist", "manual"))).rejects.toBeInstanceOf(RedeemError);
  });

  it("OAuth before webhook: redemption waits and completes when the webhook arrives", async () => {
    const key = newKey();
    const { user } = await makeAccount();
    const r = await withService((q) => redeemLicense(q, user.id, key, "oauth"));
    expect(r.status).toBe("pending");
    await send({ event: "activate", license_key: key, tier: 3, license_status: "active" });
    expect(await license(key)).toMatchObject({ user_id: user.id, status: "active" });
    expect((await loadEntitlement(user.id)).plan).toBe("agency");
  });

  it("upgrade moves the account to the new key and higher limits", async () => {
    const acct = await makeAccount({ tier: 1 });
    const newK = newKey();
    const r = await send({ event: "upgrade", license_key: newK, prev_license_key: acct.licenseKey, tier: 2, license_status: "active" });
    expect(r.status).toBe(200);
    expect(await license(acct.licenseKey!)).toMatchObject({ status: "deactivated", superseded_by: newK });
    expect(await license(newK)).toMatchObject({ status: "active", tier: 2, user_id: acct.user.id });
    const ent = await loadEntitlement(acct.user.id);
    expect(ent).toMatchObject({ plan: "growth", mode: "full", licenseKey: newK });
  });

  it("downgrade lowers limits and keeps data", async () => {
    const acct = await makeAccount({ tier: 3 });
    await makeClient(acct.ctx);
    const newK = newKey();
    await send({ event: "downgrade", license_key: newK, prev_license_key: acct.licenseKey, tier: 1, license_status: "active" });
    const ent = await loadEntitlement(acct.user.id);
    expect(ent).toMatchObject({ plan: "solo", mode: "full" });
    const n = await withTenant(acct.ctx, (q) => q.one<{ n: number }>("select count(*)::int as n from clients"));
    expect(n.n).toBe(1);
  });

  it("migrate carries the owner over to the migrated license", async () => {
    const acct = await makeAccount({ tier: 1 });
    const newK = newKey();
    await send({ event: "migrate", license_key: newK, prev_license_key: acct.licenseKey, tier: 2, license_status: "active" });
    expect(await license(newK)).toMatchObject({ user_id: acct.user.id, tier: 2, status: "active" });
    expect((await loadEntitlement(acct.user.id)).plan).toBe("growth");
  });

  it("deactivate revokes paid access, keeps data read-only and exportable, blocks re-purchase for 24h, then reactivates cleanly", async () => {
    const acct = await makeAccount({ tier: 2 });
    await makeClient(acct.ctx, { name: "Keep me" });
    const r = await send({ event: "deactivate", license_key: acct.licenseKey, tier: 2, license_status: "deactivated", extra: { reason: "Refunded by user" } });
    expect(r.status).toBe(200);
    const ent = await loadEntitlement(acct.user.id);
    expect(ent.mode).toBe("readonly");
    expect(() => assertWritable(ent)).toThrow(ReadOnlyError);
    const exported = await withTenant(acct.ctx, (q) => exportWorkspaceData(q, acct.workspace.id));
    expect((exported.clients as any[]).map((c) => c.name)).toContain("Keep me");

    // Refunded user can't redeem a new license for 24 hours.
    const other = newKey();
    await send({ event: "activate", license_key: other, tier: 1, license_status: "active" });
    await expect(withService((q) => redeemLicense(q, acct.user.id, other, "manual"))).rejects.toThrow(/refunded recently/);

    // After the cooldown, a new license reactivates the account with all data intact.
    await withService((q) => q.exec("update users set refund_block_until = now() - interval '1 minute' where id = $1", [acct.user.id]));
    await withService((q) => redeemLicense(q, acct.user.id, other, "manual"));
    expect(await loadEntitlement(acct.user.id)).toMatchObject({ plan: "solo", mode: "full" });
    const n = await withTenant(acct.ctx, (q) => q.one<{ n: number }>("select count(*)::int as n from clients"));
    expect(n.n).toBe(1);
  });

  it("re-activating the same deactivated license restores access", async () => {
    const acct = await makeAccount({ tier: 1 });
    await send({ event: "deactivate", license_key: acct.licenseKey, tier: 1 });
    expect((await loadEntitlement(acct.user.id)).mode).toBe("readonly");
    await send({ event: "activate", license_key: acct.licenseKey, tier: 1, license_status: "active" });
    expect(await loadEntitlement(acct.user.id)).toMatchObject({ plan: "solo", mode: "full" });
  });

  it("purges data 30 days after deactivation (cleanup job) but keeps the account", async () => {
    const acct = await makeAccount({ tier: 1 });
    await makeClient(acct.ctx);
    await send({ event: "deactivate", license_key: acct.licenseKey, tier: 1 });
    await withService((q) => q.exec("update licenses set deactivated_at = now() - interval '31 days' where license_key = $1", [acct.licenseKey]));
    expect((await loadEntitlement(acct.user.id)).mode).toBe("expired");
    await withService((q) => cleanupExpiredLicenses(q));
    const n = await withTenant(acct.ctx, (q) => q.one<{ n: number }>("select count(*)::int as n from clients"));
    expect(n.n).toBe(0);
    expect(await loadEntitlement(acct.user.id)).toMatchObject({ plan: "free", mode: "full" });
  });

  it("keeps working for unredeemed licenses long after purchase (60+ day redemption window)", async () => {
    const key = newKey();
    await send({ event: "activate", license_key: key, tier: 1, license_status: "active" });
    await withService((q) => q.exec("update licenses set created_at = now() - interval '200 days', activated_at = now() - interval '200 days' where license_key = $1", [key]));
    const { user } = await makeAccount();
    await withService((q) => redeemLicense(q, user.id, key, "manual"));
    expect((await loadEntitlement(user.id)).plan).toBe("solo");
  });
});

describe("AppSumo OAuth code exchange", () => {
  let server: http.Server;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url?.startsWith("/openid/token/")) {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const b = JSON.parse(body);
          if (b.code !== "good-code" || b.client_secret !== "test-client-secret") {
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: "invalid_grant" }));
          }
          const idToken = `x.${Buffer.from(JSON.stringify({ email: "buyer@example.com" })).toString("base64url")}.y`;
          res.end(JSON.stringify({ access_token: "at-123", id_token: idToken }));
        });
      } else if (req.url?.startsWith("/openid/license_key/?access_token=at-123")) {
        res.end(JSON.stringify({ license_key: "oauth-license-1", status: "active" }));
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
    await new Promise<void>((r) => server.listen(0, r));
    process.env.APPSUMO_BASE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(() => server.close());

  it("exchanges the code and returns the license key", async () => {
    expect(await exchangeAppsumoCode("good-code")).toEqual({ licenseKey: "oauth-license-1", email: "buyer@example.com" });
    await expect(exchangeAppsumoCode("bad")).rejects.toThrow(/token exchange failed/);
  });
});

describe("refund CSV reconciliation", () => {
  it("revokes refunded licenses and reports mismatches", async () => {
    const a = await makeAccount({ tier: 1 });
    const b = await makeAccount({ tier: 2 });
    const csv = `License Key,Status,Redeemed At\n${a.licenseKey},Refunded,2026-08-01\n${b.licenseKey},Redeemed,2026-08-02\nunknown-key,Redeemed,2026-08-03`;
    const parsed = parseCsv(csv);
    const s = await withService((q) => reconcileAppsumoCsv(q, parsed.rows, parsed.headers));
    expect(s).toMatchObject({ rows: 3, refunded: 1, revoked: 1, unknownKeys: ["unknown-key"] });
    expect((await loadEntitlement(a.user.id)).mode).toBe("readonly");
    expect((await loadEntitlement(b.user.id)).mode).toBe("full");
    const again = await withService((q) => reconcileAppsumoCsv(q, parsed.rows, parsed.headers));
    expect(again).toMatchObject({ revoked: 0, alreadyRevoked: 1 });
    const u = await withService((q) => q.one("select refund_block_until from users where id = $1", [a.user.id]));
    expect(new Date(u.refund_block_until).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
  });
});
