import type { Q, Row } from "./db";
import { env } from "./env";
import { signedToken, verifySignedToken } from "./crypto";
import { can, type Entitlement } from "./tiers";

export function portalBaseUrl(ws: Row, ent: Entitlement): string {
  if (can(ent, "custom_domain") && ws.custom_domain && ws.custom_domain_verified_at) return `https://${ws.custom_domain}`;
  return env.APP_URL;
}

export function portalUrlFor(linkId: string, ws: Row, ent: Entitlement): string {
  return `${portalBaseUrl(ws, ent)}/p/${signedToken(linkId, "portal")}`;
}

export async function ensurePortalLink(q: Q, workspaceId: string, clientId: string): Promise<Row> {
  const existing = await q.maybe(
    "select * from portal_links where client_id = $1 and revoked_at is null order by created_at desc limit 1",
    [clientId],
  );
  if (existing) return existing;
  return q.one("insert into portal_links (workspace_id, client_id) values ($1,$2) returning *", [workspaceId, clientId]);
}

export async function rotatePortalLink(q: Q, workspaceId: string, clientId: string): Promise<Row> {
  await q.exec("update portal_links set revoked_at = now() where client_id = $1 and revoked_at is null", [clientId]);
  return q.one("insert into portal_links (workspace_id, client_id) values ($1,$2) returning *", [workspaceId, clientId]);
}

export function parsePortalToken(token: string): string | null {
  const id = verifySignedToken(decodeURIComponent(token), "portal");
  return id && /^[0-9a-f-]{36}$/.test(id) ? id : null;
}
