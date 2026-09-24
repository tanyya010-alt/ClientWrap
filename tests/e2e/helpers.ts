import { Client } from "pg";
import { createHmac, randomUUID } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import { E2E_DB } from "../../playwright.config";

export async function sql<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: E2E_DB });
  await c.connect();
  try {
    await c.query("set role cw_service");
    return (await c.query(text, params as any[])).rows as T[];
  } finally {
    await c.end();
  }
}

export async function latestEmail(to: string, subjectLike: string) {
  for (let i = 0; i < 20; i++) {
    const rows = await sql("select * from email_outbox where to_address = $1 and subject ilike $2 order by created_at desc limit 1", [to, `%${subjectLike}%`]);
    if (rows[0]) return rows[0];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email "${subjectLike}" to ${to}`);
}

export function uniqueEmail(prefix = "user") {
  return `${prefix}-${randomUUID().slice(0, 8)}@e2e.test`;
}

export async function appsumoWebhook(request: APIRequestContext, payload: Record<string, unknown>) {
  const body = JSON.stringify({ event_timestamp: Date.now(), ...payload });
  const ts = String(Date.now());
  const sig = createHmac("sha256", "e2e-appsumo-key").update(ts + body).digest("hex");
  return request.post("/api/webhooks/appsumo", { data: body, headers: { "content-type": "application/json", "x-appsumo-timestamp": ts, "x-appsumo-signature": sig } });
}

export async function signUp(page: Page, email: string, password = "Sup3r-secret-pass") {
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Pat Tester");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.locator("input[name=terms]").check();
  await page.getByRole("button", { name: "Create account" }).click();
}

export async function verifyEmail(page: Page, email: string) {
  const mail = await latestEmail(email, "Confirm your ClientWrap email");
  const url = String(mail.text_body).match(/https?:\/\/\S+/)![0];
  await page.goto(url.replace(/^https?:\/\/[^/]+/, ""));
}

export async function logIn(page: Page, email: string, password = "Sup3r-secret-pass", next?: string) {
  await page.goto(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}
