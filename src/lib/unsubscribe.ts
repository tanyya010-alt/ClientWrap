import { withService } from "./db";
import { verifySignedToken } from "./crypto";
import { audit } from "./audit";

export function parseUnsubToken(token: string): { clientId: string; channel: "email" | "sms" | "whatsapp" } | null {
  // Tokens are URL-safe (base64url + "."), so no decoding is needed; tolerate an encoded copy anyway.
  const v = verifySignedToken(token.includes("%") ? decodeURIComponent(token) : token, "unsub");
  if (!v) return null;
  const [clientId, channel] = v.split(".");
  if (!/^[0-9a-f-]{36}$/.test(clientId) || !["email", "sms", "whatsapp"].includes(channel)) return null;
  return { clientId, channel: channel as "email" | "sms" | "whatsapp" };
}

export async function unsubscribe(token: string, ip: string | null, resubscribe = false): Promise<{ ok: boolean; workspaceName?: string }> {
  const parsed = parseUnsubToken(token);
  if (!parsed) return { ok: false };
  return withService(async (q) => {
    const client = await q.maybe("select c.id, c.workspace_id, w.name as ws_name from clients c join workspaces w on w.id = c.workspace_id where c.id = $1", [parsed.clientId]);
    if (!client) return { ok: false };
    await q.exec(
      "insert into consent_records (workspace_id, client_id, channel, action, source, ip) values ($1,$2,$3,$4,'unsubscribe_link',$5)",
      [client.workspace_id, client.id, parsed.channel, resubscribe ? "resubscribed" : "unsubscribed", ip],
    );
    await audit(q, { workspaceId: client.workspace_id, actor: "client", action: resubscribe ? "consent.resubscribed" : "consent.unsubscribed", targetType: "client", targetId: client.id, metadata: { channel: parsed.channel }, ip });
    return { ok: true, workspaceName: client.ws_name };
  });
}
