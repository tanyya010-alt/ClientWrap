import { execSync } from "node:child_process";

export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://clientwrap:clientwrap@localhost:5432/clientwrap_test";
  execSync("npx tsx scripts/migrate.ts --reset", { env: { ...process.env, DATABASE_URL: url, NODE_ENV: "test" }, stdio: "inherit" });
}
