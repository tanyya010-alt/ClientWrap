import { describe, expect, it, beforeAll } from "vitest";
import { pool, withService, withTenant, withUser } from "@/lib/db";
import { makeAccount, makeClient } from "../helpers";

/**
 * Cross-tenant isolation: workspace A can never read or write workspace B's data,
 * for EVERY table that carries workspace_id, even when the query forgets a WHERE clause.
 */
describe("row-level security", () => {
  let A: Awaited<ReturnType<typeof makeAccount>>;
  let B: Awaited<ReturnType<typeof makeAccount>>;
  let clientB: any;
  let tables: string[] = [];

  beforeAll(async () => {
    A = await makeAccount({ tier: 3 });
    B = await makeAccount({ tier: 3 });
    await makeClient(A.ctx, { name: "A client" });
    clientB = await makeClient(B.ctx, { name: "B client" });
    // Seed one row in every tenant table for B.
    await withTenant(B.ctx, async (q) => {
      const w = B.workspace.id, c = clientB.id;
      await q.exec("insert into consent_records (workspace_id, client_id, channel, action, source) values ($1,$2,'sms','granted','test')", [w, c]);
      await q.exec("insert into portal_links (workspace_id, client_id) values ($1,$2)", [w, c]);
      await q.exec("insert into webhook_secrets (workspace_id, client_id, public_token, secret_enc) values ($1,$2,$3,'x')", [w, c, `tok-${c}`]);
      await q.exec("insert into metric_events (workspace_id, client_id, metric, value, occurred_at, source) values ($1,$2,'leads',1,now(),'manual')", [w, c]);
      await q.exec("insert into csv_imports (workspace_id, client_id, mapping, rows_total, rows_imported) values ($1,$2,'{}',1,1)", [w, c]);
      const r = await q.one("insert into reports (workspace_id, client_id, period, data_snapshot) values ($1,$2,'2026-08','{}') returning id", [w, c]);
      const inv = await q.one("insert into invoices (workspace_id, client_id, number, due_date) values ($1,$2,'INV-1',current_date) returning id", [w, c]);
      await q.exec("insert into invoice_items (workspace_id, invoice_id, description, unit_amount_cents, amount_cents) values ($1,$2,'x',1,1)", [w, inv.id]);
      await q.exec("insert into payments (workspace_id, invoice_id, amount_cents, currency, method) values ($1,$2,1,'USD','manual')", [w, inv.id]);
      await q.exec("insert into message_log (workspace_id, client_id, kind, channel, status) values ($1,$2,'test','email','sent')", [w, c]);
      await q.exec("insert into case_studies (workspace_id, client_id, report_id, title, body) values ($1,$2,$3,'t','b')", [w, c, r.id]);
      await q.exec("insert into renewal_suggestions (workspace_id, client_id, title, body) values ($1,$2,'t','b')", [w, c]);
      await q.exec("insert into usage_counters (workspace_id, period, metric, count) values ($1,'2026-09','emails',1)", [w]);
      await q.exec("insert into audit_log (workspace_id, action) values ($1,'test')", [w]);
    });
    const rows = await withService((q) =>
      q.many<{ table_name: string }>(
        `select table_name from information_schema.columns
         where table_schema = 'public' and column_name = 'workspace_id' order by table_name`,
      ),
    );
    tables = rows.map((r) => r.table_name);
  });

  it("covers every tenant table", () => {
    expect(tables).toEqual(expect.arrayContaining(["clients", "metric_events", "reports", "invoices", "message_log", "case_studies", "audit_log"]));
  });

  it("every table has RLS enabled and forced", async () => {
    const rows = await withService((q) =>
      q.many<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c
         join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'schema_migrations'`,
      ),
    );
    expect(rows.length).toBeGreaterThan(25);
    for (const r of rows) {
      expect(r.relrowsecurity, `${r.relname} RLS enabled`).toBe(true);
      expect(r.relforcerowsecurity, `${r.relname} RLS forced`).toBe(true);
    }
  });

  it("workspace A reads zero rows of B from every table, even without a WHERE clause", async () => {
    for (const t of tables) {
      const tenantTable = !["stripe_events", "support_tickets", "email_outbox"].includes(t);
      const result = await withTenant(A.ctx, async (q) => {
        try {
          return await q.many(`select workspace_id from ${t}`);
        } catch (e) {
          return (e as Error).message;
        }
      });
      if (typeof result === "string") {
        expect(result, `${t} should deny tenant role`).toMatch(/permission denied/);
        expect(tenantTable ? ["stripe_events"] : [t]).toContain(t); // only non-tenant tables may deny outright
      } else {
        for (const row of result) expect(row.workspace_id, `${t} leaked`).not.toBe(B.workspace.id);
      }
    }
  });

  it("B can see its own data (sanity check)", async () => {
    const n = await withTenant(B.ctx, (q) => q.one<{ n: number }>("select count(*)::int as n from metric_events"));
    expect(n.n).toBe(1);
  });

  it("A cannot insert rows into B's workspace", async () => {
    await expect(
      withTenant(A.ctx, (q) =>
        q.exec("insert into metric_events (workspace_id, client_id, metric, value, occurred_at, source) values ($1,$2,'x',1,now(),'manual')", [B.workspace.id, clientB.id]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("A cannot update or delete B's rows", async () => {
    const updated = await withTenant(A.ctx, (q) => q.exec("update clients set name = 'pwned' where id = $1", [clientB.id]));
    const deleted = await withTenant(A.ctx, (q) => q.exec("delete from clients where id = $1", [clientB.id]));
    expect(updated).toBe(0);
    expect(deleted).toBe(0);
    const c = await withTenant(B.ctx, (q) => q.one("select name from clients where id = $1", [clientB.id]));
    expect(c.name).toBe("B client");
  });

  it("A cannot select B's workspace by pretending to be it without owning it", async () => {
    const rows = await withTenant({ userId: A.user.id, workspaceId: B.workspace.id }, (q) => q.many("select * from workspaces"));
    expect(rows).toHaveLength(0);
  });

  it("users and licenses are only visible to their owner", async () => {
    const users = await withUser(A.user.id, (q) => q.many("select id from users"));
    expect(users.map((u) => u.id)).toEqual([A.user.id]);
    const lic = await withUser(A.user.id, (q) => q.many("select license_key from licenses"));
    expect(lic.map((l) => l.license_key)).toEqual([A.licenseKey]);
  });

  it("tenants cannot modify licenses (license state only comes from webhooks)", async () => {
    await expect(withUser(A.user.id, (q) => q.exec("update licenses set tier = 3"))).rejects.toThrow(/permission denied/);
    await expect(withUser(A.user.id, (q) => q.exec("insert into licenses (license_key) values ('forged')"))).rejects.toThrow(/permission denied/);
  });

  it("service-only tables are invisible to tenants", async () => {
    for (const t of ["sessions", "auth_tokens", "license_events", "jobs", "rate_limits", "email_outbox", "error_events", "stripe_events", "pending_redemptions"]) {
      await expect(withTenant(A.ctx, (q) => q.many(`select * from ${t}`)), t).rejects.toThrow(/permission denied/);
    }
  });

  it("the raw connection role (table owner) sees nothing: code that bypasses the helpers fails closed", async () => {
    const res = await pool().query("select count(*)::int as n from clients");
    expect(res.rows[0].n).toBe(0);
  });
});
