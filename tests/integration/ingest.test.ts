import { describe, expect, it, beforeAll } from "vitest";
import { handleIngest, signIngest } from "@/lib/ingest";
import { withTenant, withService } from "@/lib/db";
import { encrypt, randomToken } from "@/lib/crypto";
import { makeAccount, makeClient } from "../helpers";

async function setupHook(tier?: number) {
  const acct = await makeAccount({ tier });
  const client = await makeClient(acct.ctx);
  const secret = randomToken(24);
  const token = randomToken(16);
  await withTenant(acct.ctx, (q) =>
    q.exec("insert into webhook_secrets (workspace_id, client_id, public_token, secret_enc) values ($1,$2,$3,$4)", [acct.workspace.id, client.id, token, encrypt(secret)]),
  );
  return { acct, client, secret, token };
}

function signed(secret: string, body: string, extra: Record<string, string> = {}) {
  const ts = String(Math.floor(Date.now() / 1000));
  return new Headers({ "x-clientwrap-timestamp": ts, "x-clientwrap-signature": signIngest(secret, ts, body), ...extra });
}

describe("metrics webhook", () => {
  let h: Awaited<ReturnType<typeof setupHook>>;
  beforeAll(async () => {
    h = await setupHook(1);
  });

  it("accepts a signed event", async () => {
    const body = JSON.stringify({ metric: "Leads", value: 12, unit: "leads", timestamp: "2026-09-01" });
    const r = await handleIngest(h.token, body, signed(h.secret, body));
    expect(r).toMatchObject({ status: 200, body: { accepted: 1, duplicates: 0 } });
  });

  it("is idempotent with Idempotency-Key", async () => {
    const body = JSON.stringify({ metric: "Leads", value: 5 });
    const a = await handleIngest(h.token, body, signed(h.secret, body, { "idempotency-key": "evt-1" }));
    const b = await handleIngest(h.token, body, signed(h.secret, body, { "idempotency-key": "evt-1" }));
    expect(a.body).toMatchObject({ accepted: 1 });
    expect(b.body).toMatchObject({ accepted: 0, duplicates: 1 });
  });

  it("accepts batches and reports per-event errors", async () => {
    const body = JSON.stringify({ events: [{ metric: "a", value: 1, idempotency_key: "b1" }, { metric: "b", value: "oops" }, { value: 3 }] });
    const r = await handleIngest(h.token, body, signed(h.secret, body));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ accepted: 1, rejected: 2 });
  });

  it("supports bearer-secret auth for no-code tools", async () => {
    const body = JSON.stringify({ metric: "Calls", value: 3 });
    const r = await handleIngest(h.token, body, new Headers({ authorization: `Bearer ${h.secret}` }));
    expect(r.status).toBe(200);
  });

  it("rejects bad signatures, stale timestamps, missing auth and unknown tokens", async () => {
    const body = JSON.stringify({ metric: "x", value: 1 });
    expect((await handleIngest(h.token, body, signed("wrong", body))).status).toBe(401);
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect((await handleIngest(h.token, body, new Headers({ "x-clientwrap-timestamp": old, "x-clientwrap-signature": signIngest(h.secret, old, body) }))).status).toBe(401);
    expect((await handleIngest(h.token, body, new Headers())).status).toBe(401);
    expect((await handleIngest("nope", body, signed(h.secret, body))).status).toBe(404);
    expect((await handleIngest(h.token, "{bad", signed(h.secret, "{bad"))).status).toBe(400);
  });

  it("writes only to the hook's own client and registers new metrics", async () => {
    const rows = await withTenant(h.acct.ctx, (q) => q.many("select distinct client_id from metric_events"));
    expect(rows.map((r) => r.client_id)).toEqual([h.client.id]);
    const c = await withTenant(h.acct.ctx, (q) => q.one("select metric_config from clients where id = $1", [h.client.id]));
    expect(Object.keys(c.metric_config)).toEqual(expect.arrayContaining(["leads", "calls"]));
  });

  it("gates the webhook by plan and revocation", async () => {
    const free = await setupHook();
    const body = JSON.stringify({ metric: "x", value: 1 });
    const r = await handleIngest(free.token, body, signed(free.secret, body));
    expect(r.status).toBe(402);
    expect(String(r.body.error)).toMatch(/Solo plan/);
    await withService((q) => q.exec("update webhook_secrets set revoked_at = now() where public_token = $1", [h.token]));
    expect((await handleIngest(h.token, body, signed(h.secret, body))).status).toBe(404);
  });
});
