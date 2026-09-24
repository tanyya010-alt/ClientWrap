import { execSync } from "node:child_process";
import { E2E_DB } from "../../playwright.config";

export default function setup() {
  execSync("npx tsx scripts/migrate.ts --reset", { env: { ...process.env, DATABASE_URL: E2E_DB, NODE_ENV: "test" }, stdio: "inherit" });
}
