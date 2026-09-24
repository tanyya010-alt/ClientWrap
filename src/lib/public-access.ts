import { withService, withTenant, type Q, type Row } from "./db";
import { loadEntitlementQ } from "./entitlements";
import { parsePortalToken } from "./portal";
import { verifySignedToken } from "./crypto";
import type { Entitlement } from "./tiers";
import { env } from "./env";

export interface PublicCtx {
  workspace: Row;
  client: Row;
  ent: Entitlement;
  link?: Row;
}

/** Resolve a portal token to its workspace/client. Returns null if invalid, revoked or unavailable. */
export async function resolvePortal(token: string, host?: string | null): Promise<(PublicCtx & { link: Row }) | null> {
  const linkId = parsePortalToken(token);
  if (!linkId) return null;
  return withService(async (q) => {
    const link = await q.maybe("select * from portal_links where id = $1 and revoked_at is null", [linkId]);
    if (!link) return null;
    const workspace = await q.one("select * from workspaces where id = $1", [link.workspace_id]);
    const client = await q.one("select * from clients where id = $1", [link.client_id]);
    if (client.archived_at) return null;
    if (host && !hostAllowed(host, workspace)) return null;
    const ent = await loadEntitlementQ(q, workspace.owner_id);
    return { link, workspace, client, ent };
  });
}

/** A custom domain may only serve portals of the workspace that verified it. */
export function hostAllowed(host: string, workspace: Row): boolean {
  const h = host.toLowerCase().split(":")[0];
  const appHost = new URL(env.APP_URL).hostname.toLowerCase();
  if (h === appHost || h === "localhost" || h === "127.0.0.1") return true;
  return Boolean(workspace.custom_domain_verified_at && workspace.custom_domain && workspace.custom_domain.toLowerCase() === h);
}

export async function resolveInvoiceToken(token: string): Promise<(PublicCtx & { invoice: Row }) | null> {
  const id = verifySignedToken(decodeURIComponent(token), "pay");
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  return withService(async (q) => {
    const invoice = await q.maybe("select * from invoices where id = $1", [id]);
    if (!invoice) return null;
    const workspace = await q.one("select * from workspaces where id = $1", [invoice.workspace_id]);
    const client = await q.one("select * from clients where id = $1", [invoice.client_id]);
    const ent = await loadEntitlementQ(q, workspace.owner_id);
    return { invoice, workspace, client, ent };
  });
}

/** Read data for a public page inside the owning workspace's tenant context (RLS still applies). */
export function asOwner<T>(ctx: PublicCtx, fn: (q: Q) => Promise<T>): Promise<T> {
  return withTenant({ userId: ctx.workspace.owner_id, workspaceId: ctx.workspace.id }, fn);
}
