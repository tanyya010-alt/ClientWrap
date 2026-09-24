import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const PORT = 3100;
export const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgres://clientwrap:clientwrap@localhost:5432/clientwrap_e2e";
export const MOCK_APPSUMO_PORT = 4599;
const chromium = process.env.PW_CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: chromium ? { executablePath: chromium } : {},
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    // Readiness probe must not need the DB: global setup (migrations) runs after the server starts.
    url: `http://localhost:${PORT}/legal/terms`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: "production",
      DATABASE_URL: E2E_DB,
      APP_URL: `http://localhost:${PORT}`,
      APP_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e-secret",
      ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
      APPSUMO_API_KEY: "e2e-appsumo-key",
      APPSUMO_CLIENT_ID: "e2e-client",
      APPSUMO_CLIENT_SECRET: "e2e-client-secret",
      APPSUMO_BASE_URL: `http://127.0.0.1:${MOCK_APPSUMO_PORT}`,
      ALLOW_OUTBOX_EMAIL: "true",
      ADMIN_EMAILS: "admin@e2e.test",
      CRON_SECRET: "e2e-cron",
      RESEND_API_KEY: "",
    },
  },
});
