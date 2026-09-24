/**
 * Import AppSumo's refunded/redeemed codes CSV and revoke refunded licenses.
 * Usage: npm run appsumo:reconcile -- path/to/appsumo-codes.csv [--dry-run]
 *
 * Each refunded row is replayed as a "deactivate" through the same state machine as the webhook:
 * paid access is revoked, data stays read-only for 30 days, and the user can't redeem a new license
 * for 24 hours. Safe to run repeatedly (already-revoked licenses are skipped).
 */
import { readFileSync } from "node:fs";
import { loadEnvFile } from "./load-env";
loadEnvFile();

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const dry = process.argv.includes("--dry-run");
  if (!file) {
    console.error("Usage: npm run appsumo:reconcile -- <file.csv> [--dry-run]");
    process.exit(1);
  }
  const { parseCsv } = await import("../src/lib/metrics");
  const { reconcileAppsumoCsv } = await import("../src/lib/appsumo");
  const { withService, pool } = await import("../src/lib/db");
  const { audit } = await import("../src/lib/audit");
  const parsed = parseCsv(readFileSync(file, "utf8"));
  console.log(`Read ${parsed.rows.length} rows; columns: ${parsed.headers.join(", ")}`);
  const run = async () =>
    withService(async (q) => {
      const s = await reconcileAppsumoCsv(q, parsed.rows, parsed.headers);
      if (dry) throw Object.assign(new Error("dry-run"), { summary: s });
      await audit(q, { workspaceId: null, actor: "system", action: "appsumo.reconciled", metadata: { ...s, file } });
      return s;
    });
  let summary;
  try {
    summary = await run();
  } catch (e: any) {
    if (e.message !== "dry-run") throw e;
    summary = e.summary;
    console.log("DRY RUN: no changes were saved.");
  }
  console.log(JSON.stringify(summary, null, 2));
  await pool().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
