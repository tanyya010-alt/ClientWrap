import { getAppContext, inTenant, type AppContext } from "./auth";
import { json } from "./http";
import { toActionError } from "./actions";
import type { Q } from "./db";

/** JSON API wrapper: session-authenticated, tenant-scoped (RLS), consistent error shape. */
export async function apiHandler(fn: (ctx: AppContext, q: Q) => Promise<{ status?: number; body: unknown }>) {
  const ctx = await getAppContext();
  if (!ctx) return json({ error: "unauthorized" }, 401);
  try {
    const r = await inTenant(ctx, (q) => fn(ctx, q));
    return json(r.body, r.status ?? 200);
  } catch (e) {
    const err = toActionError(e);
    return json({ error: err?.error, upgradeTo: err?.upgradeTo ?? undefined }, 400);
  }
}
