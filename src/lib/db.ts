import { Pool, type PoolClient } from "pg";
import { env } from "./env";

/**
 * All runtime queries go through withTenant() or withService().
 * Each opens a transaction and switches to a restricted role:
 *   withTenant  -> cw_app      (RLS restricts rows to app.workspace_id / app.user_id)
 *   withService -> cw_service  (trusted server-side flows: webhooks, jobs, auth, admin)
 * The connection's own role (table owner) has FORCE RLS with no policies, so a query that
 * bypasses these helpers fails closed and sees nothing.
 */

declare global {
  // eslint-disable-next-line no-var
  var __cwPool: Pool | undefined;
}

export function pool(): Pool {
  if (!globalThis.__cwPool) {
    globalThis.__cwPool = new Pool({
      connectionString: env.DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return globalThis.__cwPool;
}

export type Row = Record<string, any>;

export class Q {
  constructor(private client: PoolClient) {}
  async many<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.client.query(sql, params as any[]);
    return res.rows as T[];
  }
  async one<T = Row>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.many<T>(sql, params);
    if (rows.length === 0) throw new NotFoundError();
    return rows[0];
  }
  async maybe<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.many<T>(sql, params);
    return rows[0] ?? null;
  }
  async exec(sql: string, params: unknown[] = []): Promise<number> {
    const res = await this.client.query(sql, params as any[]);
    return res.rowCount ?? 0;
  }
}

export class NotFoundError extends Error {
  constructor(msg = "Not found") {
    super(msg);
  }
}

async function inTx<T>(setup: (c: PoolClient) => Promise<void>, fn: (q: Q) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    await setup(client);
    const result = await fn(new Q(client));
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export interface TenantCtx {
  userId: string | null;
  workspaceId: string;
}

export function withTenant<T>(ctx: TenantCtx, fn: (q: Q) => Promise<T>): Promise<T> {
  return inTx(async (c) => {
    await c.query("set local role cw_app");
    await c.query("select set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)", [
      ctx.userId ?? "",
      ctx.workspaceId,
    ]);
  }, fn);
}

/** User-scoped context without a workspace (e.g. reading own licenses). */
export function withUser<T>(userId: string, fn: (q: Q) => Promise<T>): Promise<T> {
  return inTx(async (c) => {
    await c.query("set local role cw_app");
    await c.query("select set_config('app.user_id', $1, true), set_config('app.workspace_id', '', true)", [userId]);
  }, fn);
}

export function withService<T>(fn: (q: Q) => Promise<T>): Promise<T> {
  return inTx(async (c) => {
    await c.query("set local role cw_service");
  }, fn);
}
