/**
 * Seeds reviewer accounts for every tier with realistic demo data.
 * Idempotent: existing accounts are left alone (use --reset-reviewers to rebuild them).
 *
 * Licenses are NOT inserted directly: each one is created by a signed AppSumo webhook payload
 * processed by the same handler as production (license state only ever comes from webhooks).
 */
import { loadEnvFile } from "./load-env";
loadEnvFile();

const PASSWORD = process.env.REVIEWER_PASSWORD || "Review-ClientWrap-2026";
const DOMAIN = process.env.REVIEWER_EMAIL_DOMAIN || "clientwrap.app";

const REVIEWERS = [
  { email: `reviewer+free@${DOMAIN}`, name: "Riley Free", business: "Riley Coaching", service: "coaching", tier: null as number | null, clients: 1 },
  { email: `reviewer+tier1@${DOMAIN}`, name: "Sam Solo", business: "Sam Builds Automations", service: "automation", tier: 1, clients: 3 },
  { email: `reviewer+tier2@${DOMAIN}`, name: "Gina Growth", business: "Greenfield SEO", service: "seo", tier: 2, clients: 6 },
  { email: `reviewer+tier3@${DOMAIN}`, name: "Alex Agency", business: "Brightline Studio", service: "design", tier: 3, clients: 9 },
  { email: `reviewer+admin@${DOMAIN}`, name: "Support Admin", business: "ClientWrap Support", service: "general", tier: 3, clients: 0 },
];

const CLIENT_NAMES = [
  ["Northwind Bakery", "Maya Lopez"], ["Brightpath Logistics", "Sam Okafor"], ["Harbor Dental", "Dr. Lena Park"],
  ["Summit Fitness", "Jordan Reyes"], ["Oakleaf Realty", "Priya Nair"], ["Bluebird Cafe", "Tom Becker"],
  ["Copperline Legal", "Ana Silva"], ["Lumen Skincare", "Chloe Martin"], ["Vector Robotics", "Ken Ito"],
];

async function main() {
  const { withService, pool } = await import("../src/lib/db");
  const { createUserWithWorkspace } = await import("../src/lib/auth");
  const { handleAppsumoWebhook, applyLicenseEvent, recordLicenseEvent } = await import("../src/lib/appsumo");
  const { hmacHex } = await import("../src/lib/crypto");
  const { loadDemoWorkspace } = await import("../src/lib/demo");
  const { getTemplate } = await import("../src/lib/templates");
  const { redeemLicense } = await import("../src/lib/appsumo");
  const reset = process.argv.includes("--reset-reviewers");

  async function webhook(payload: Record<string, unknown>) {
    const body = JSON.stringify({ event_timestamp: Date.now(), ...payload });
    const key = process.env.APPSUMO_API_KEY;
    if (key) {
      const ts = String(Date.now());
      const r = await handleAppsumoWebhook(body, new Headers({ "x-appsumo-timestamp": ts, "x-appsumo-signature": hmacHex(key, ts + body) }));
      if (r.status !== 200) throw new Error(`webhook failed: ${JSON.stringify(r.body)}`);
    } else {
      // No API key in this environment: record + apply exactly as the webhook handler would.
      const p = JSON.parse(body);
      await withService(async (q) => {
        const rec = await recordLicenseEvent(q, p, "webhook", "seed-unsigned");
        if (!rec.duplicate) {
          await applyLicenseEvent(q, p);
          await q.exec("update license_events set processed_at = now() where id = $1", [rec.eventId]);
        }
      });
    }
  }

  for (const r of REVIEWERS) {
    const existing = await withService((q) => q.maybe("select id from users where lower(email) = $1", [r.email]));
    if (existing && !reset) {
      console.log(`exists: ${r.email}`);
      continue;
    }
    if (existing) {
      await withService(async (q) => {
        await q.exec("update licenses set user_id = null where user_id = $1", [existing.id]);
        await q.exec("delete from users where id = $1", [existing.id]);
      });
    }
    const { user, workspace } = await withService((q) => createUserWithWorkspace(q, { email: r.email, name: r.name, password: PASSWORD, verified: true }));
    const t = getTemplate(r.service);
    await withService((q) =>
      q.exec(
        `update workspaces set name=$2, service_type=$3, timezone='America/New_York', brand_color=$4, accent_color=$4,
           reply_to_email=$5, payment_instructions=$6, onboarding_step=6, onboarding_completed_at=now(), remove_branding=$7 where id=$1`,
        [workspace.id, r.business, r.service, ["#0f766e", "#4f46e5", "#b45309", "#be185d", "#334155"][REVIEWERS.indexOf(r)], r.email,
          "Bank transfer: Example Bank, IBAN XX00 0000 0000 0000 (reference: invoice number)", r.tier === 3],
      ),
    );
    if (r.tier) {
      const key = `REVIEW-T${r.tier}-${user.id.slice(0, 8).toUpperCase()}`;
      await webhook({ event: "purchase", license_key: key, tier: r.tier, plan_id: `clientwrap_tier${r.tier}`, license_status: "inactive" });
      await withService((q) => redeemLicense(q, user.id, key, "manual"));
      await webhook({ event: "activate", license_key: key, tier: r.tier, plan_id: `clientwrap_tier${r.tier}`, license_status: "active" });
      console.log(`license ${key} -> ${r.email}`);
    }
    if (r.clients > 0) {
      const clients = CLIENT_NAMES.slice(0, r.clients).map(([name, contact], i) => ({
        name,
        contact,
        email: `${contact.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "")}@${name.toLowerCase().replace(/[^a-z]+/g, "")}.example`,
        template: i % 3 === 2 && r.service !== "general" ? r.service : t.key,
        fee: [180000, 250000, 120000, 90000, 150000, 60000, 210000, 130000, 300000][i],
      }));
      const ws = await withService((q) => q.one("select * from workspaces where id = $1", [workspace.id]));
      await withService((q) => loadDemoWorkspace(q, ws, { isDemo: false, clients }));
      await withService(async (q) => {
        const first = await q.one("select * from clients where workspace_id = $1 order by created_at limit 1", [workspace.id]);
        await q.exec("update clients set report_day = 3, report_auto_send = false where workspace_id = $1", [workspace.id]);
        await q.exec(
          "insert into consent_records (workspace_id, client_id, channel, action, source, evidence) values ($1,$2,'sms','granted','provider','Signed onboarding form, SMS reminders box ticked')",
          [workspace.id, first.id],
        );
        if (r.tier && r.tier >= 2) {
          await q.exec(
            `insert into case_studies (workspace_id, client_id, title, body, status, approved_by_name, approved_at, public_slug, published_at)
             values ($1,$2,$3,$4,'published',$5, now() - interval '2 days', $6, now() - interval '1 day')`,
            [workspace.id, first.id, `How ${first.name} grew with ${r.business}`, `Client\n${first.name} worked with ${r.business} on ${first.service_description}.\n\nResults\nSteady month-over-month growth across every tracked metric.`, first.contact_name, `review-${r.tier}-${user.id.slice(0, 6)}`],
          );
        }
      });
    }
    console.log(`seeded ${r.email}`);
  }

  // Spare, unredeemed licenses so reviewers can test redemption, upgrade and refund flows.
  for (const tier of [1, 2, 3]) {
    const key = `REVIEW-SPARE-T${tier}`;
    const exists = await withService((q) => q.maybe("select 1 from licenses where license_key = $1", [key]));
    if (!exists) {
      await webhook({ event: "purchase", license_key: key, tier, plan_id: `clientwrap_tier${tier}`, license_status: "inactive" });
      await webhook({ event: "activate", license_key: key, tier, plan_id: `clientwrap_tier${tier}`, license_status: "active" });
      console.log(`spare license ${key}`);
    }
  }
  console.log(`\nReviewer password: ${PASSWORD}`);
  await pool().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
