/**
 * Long-running job worker for self-hosting (alternative to Vercel Cron hitting /api/cron).
 * Runs tick() every 60 seconds: enqueues periodic jobs and processes due jobs with retries/dead-lettering.
 */
import { loadEnvFile } from "./load-env";
loadEnvFile();

async function main() {
  const { tick } = await import("../src/lib/jobs/handlers");
  const once = process.argv.includes("--once");
  let stopping = false;
  process.on("SIGTERM", () => (stopping = true));
  process.on("SIGINT", () => (stopping = true));
  do {
    try {
      const r = await tick();
      if (r.ran) console.log(new Date().toISOString(), "jobs", r);
    } catch (e) {
      console.error("tick failed", e);
    }
    if (once) break;
    for (let i = 0; i < 60 && !stopping; i++) await new Promise((r) => setTimeout(r, 1000));
  } while (!stopping);
  const { pool } = await import("../src/lib/db");
  await pool().end();
}

main();
