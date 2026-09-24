import { zipSync, strToU8 } from "fflate";
import type { Q } from "./db";
import { withService } from "./db";

export const EXPORT_TABLES = [
  "clients",
  "metric_events",
  "reports",
  "invoices",
  "invoice_items",
  "payments",
  "reminder_rules",
  "message_log",
  "consent_records",
  "case_studies",
  "renewal_suggestions",
  "portal_links",
  "csv_imports",
  "audit_log",
] as const;

/** Runs inside a tenant transaction, so RLS guarantees only this workspace's rows are exported. */
export async function exportWorkspaceData(q: Q, workspaceId: string) {
  const ws = await q.one(
    `select id, name, service_type, timezone, currency, brand_color, accent_color, remove_branding, custom_domain,
            email_from_name, email_from_address, reply_to_email, quiet_hours_start, quiet_hours_end, skip_weekends,
            payment_instructions, created_at from workspaces where id = $1`,
    [workspaceId],
  );
  const user = await q.maybe("select id, email, name, email_verified_at, created_at from users where id = app.user_id()");
  const licenses = await q.many("select license_key, tier, status, activated_at, deactivated_at from licenses");
  const data: Record<string, unknown[]> = {};
  for (const t of EXPORT_TABLES) {
    data[t] = await q.many(`select * from ${t} where workspace_id = $1 order by 1`, [workspaceId]);
  }
  return { exported_at: new Date().toISOString(), format_version: 1, account: user, workspace: ws, licenses, ...data };
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Array.from(rows.reduce((set, r) => (Object.keys(r).forEach((k) => set.add(k)), set), new Set<string>()));
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
}

export function exportZip(data: Record<string, unknown>): Uint8Array {
  const files: Record<string, Uint8Array> = { "export.json": strToU8(JSON.stringify(data, null, 2)) };
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) files[`${k}.csv`] = strToU8(toCsv(v as Record<string, unknown>[]));
  }
  return zipSync(files);
}

/** Permanently deletes a user, their workspace and all tenant data (cascades). Licenses are unlinked, not deleted. */
export async function deleteAccount(userId: string) {
  await withService(async (q) => {
    await q.exec("update licenses set user_id = null where user_id = $1", [userId]);
    await q.exec("delete from users where id = $1", [userId]);
  });
}
