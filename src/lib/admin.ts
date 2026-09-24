import type { Q } from "./db";
import { loadEntitlementQ, usageSnapshot } from "./entitlements";

export async function adminSearch(q: Q, term: string) {
  const t = term.trim();
  if (!t) return { licenses: [], users: [] };
  const licenses = await q.many(
    `select l.*, u.email from licenses l left join users u on u.id = l.user_id
     where l.license_key ilike $1 or l.prev_license_key ilike $1 or u.email ilike $1
     order by l.updated_at desc limit 50`,
    [`%${t}%`],
  );
  const users = await q.many(
    `select u.id, u.email, u.name, u.created_at, w.id as workspace_id, w.name as workspace_name
     from users u left join workspaces w on w.owner_id = u.id where u.email ilike $1 order by u.created_at desc limit 20`,
    [`%${t}%`],
  );
  return { licenses, users };
}

export async function adminLicenseDetail(q: Q, key: string) {
  const license = await q.maybe("select * from licenses where license_key = $1", [key]);
  const events = await q.many("select * from license_events where license_key = $1 or payload->>'prev_license_key' = $1 order by received_at desc", [key]);
  const related = license
    ? await q.many("select license_key, status, tier, superseded_by, prev_license_key from licenses where license_key in ($1, $2) or prev_license_key = $3 or superseded_by = $3", [license.prev_license_key ?? "", license.superseded_by ?? "", key])
    : [];
  const pending = await q.maybe("select p.*, u.email from pending_redemptions p join users u on u.id = p.user_id where license_key = $1", [key]);
  let account = null;
  if (license?.user_id) {
    const user = await q.one("select id, email, name, email_verified_at, refund_block_until, created_at from users where id = $1", [license.user_id]);
    const workspace = await q.maybe("select id, name, created_at, onboarding_completed_at, custom_domain from workspaces where owner_id = $1", [license.user_id]);
    const entitlement = await loadEntitlementQ(q, license.user_id);
    const usage = workspace ? await usageSnapshot(q, workspace.id, entitlement) : null;
    const counts = workspace
      ? await q.one(
          `select (select count(*) from clients where workspace_id = $1)::int as clients,
                  (select count(*) from reports where workspace_id = $1)::int as reports,
                  (select count(*) from invoices where workspace_id = $1)::int as invoices,
                  (select max(created_at) from audit_log where workspace_id = $1) as last_activity`,
          [workspace.id],
        )
      : null;
    const audit = workspace ? await q.many("select * from audit_log where workspace_id = $1 order by created_at desc limit 30", [workspace.id]) : [];
    account = { user, workspace, entitlement, usage, counts, audit };
  }
  return { license, events, related, pending, account };
}
