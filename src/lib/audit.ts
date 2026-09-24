import type { Q } from "./db";

export async function audit(
  q: Q,
  entry: {
    workspaceId: string | null;
    userId?: string | null;
    actor?: "user" | "system" | "admin" | "client" | "appsumo" | "stripe";
    action: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
    ip?: string | null;
  },
) {
  await q.exec(
    `insert into audit_log (workspace_id, user_id, actor, action, target_type, target_id, metadata, ip)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      entry.workspaceId,
      entry.userId ?? null,
      entry.actor ?? "user",
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      JSON.stringify(entry.metadata ?? {}),
      entry.ip ?? null,
    ],
  );
}
