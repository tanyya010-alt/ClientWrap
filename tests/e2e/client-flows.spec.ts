import { expect, test } from "@playwright/test";
import { createHmac } from "node:crypto";
import { latestEmail, signUp, sql, uniqueEmail, verifyEmail } from "./helpers";

test("invoice → reminders → unsubscribe; metrics webhook; portal", async ({ page, request }) => {
  const email = uniqueEmail("flows");
  await signUp(page, email);
  await page.waitForURL("**/onboarding");
  await verifyEmail(page, email);
  // Give this account a Solo license through the webhook so reminders & webhook are enabled.
  const { appsumoWebhook } = await import("./helpers");
  const key = `e2e-flows-${Date.now()}`;
  await appsumoWebhook(request, { event: "activate", license_key: key, tier: 1, license_status: "active" });
  await page.goto("/app/billing");
  await page.getByLabel("AppSumo license key").fill(key);
  await page.getByRole("button", { name: "Apply license" }).click();
  await expect(page.getByText("License applied")).toBeVisible();

  // Client
  const clientEmail = uniqueEmail("client");
  await page.goto("/app/clients/new");
  await page.getByLabel("Client / company name").fill("Webhook Widgets");
  await page.getByLabel("Contact email").fill(clientEmail);
  await page.getByRole("button", { name: "Create client" }).click();
  await page.waitForURL("**/data?new=1");

  // Webhook with HMAC signature
  await page.getByRole("button", { name: "Create webhook" }).click();
  const url = (await page.locator("code").first().textContent())!;
  await page.getByRole("button", { name: "Reveal" }).click();
  const secret = (await page.locator("code").nth(1).textContent())!;
  expect(secret).toMatch(/^cwsec_/);
  const body = JSON.stringify({ metric: "Leads", value: 42, unit: "leads", idempotency_key: "e2e-1" });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = "sha256=" + createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  const path = new URL(url).pathname;
  const r1 = await request.post(path, { data: body, headers: { "content-type": "application/json", "x-clientwrap-timestamp": ts, "x-clientwrap-signature": sig } });
  expect(await r1.json()).toMatchObject({ accepted: 1 });
  const r2 = await request.post(path, { data: body, headers: { "content-type": "application/json", "x-clientwrap-timestamp": ts, "x-clientwrap-signature": sig } });
  expect(await r2.json()).toMatchObject({ accepted: 0, duplicates: 1 });
  const bad = await request.post(path, { data: body, headers: { "content-type": "application/json", "x-clientwrap-timestamp": ts, "x-clientwrap-signature": "sha256=bad" } });
  expect(bad.status()).toBe(401);

  // Invoice, sent
  await page.goto("/app/invoices/new");
  await page.getByLabel("Client").selectOption({ label: "Webhook Widgets" });
  await page.getByLabel("Unit price").fill("750");
  await page.getByRole("button", { name: "Save & send to client" }).click();
  await page.waitForURL("**/app/invoices/*?sent=1");
  const invMail = await latestEmail(clientEmail, "Invoice INV-0001");
  const payLink = String(invMail.text_body).match(/http:\/\/localhost:3100\/pay\/\S+/)![0];
  const invoiceId = page.url().split("/app/invoices/")[1].split("?")[0];

  // Reminder due: make the invoice 1 day overdue and run the scheduler on a weekday afternoon.
  await sql("update invoices set due_date = current_date - 1 where id = $1", [invoiceId]);
  await sql("update workspaces set quiet_hours_start = 0, quiet_hours_end = 0, skip_weekends = false");
  const cron = await request.get("/api/cron", { headers: { authorization: "Bearer e2e-cron" } });
  expect(cron.status()).toBe(200);
  const reminder = await latestEmail(clientEmail, "Friendly reminder");
  expect(reminder.text_body).toContain("Unsubscribe:");

  // Client pays the invoice page (no Stripe connected: payment instructions) — provider marks paid → reminders stop.
  const client = await page.context().browser()!.newContext();
  const cp = await client.newPage();
  await cp.goto(payLink.replace("http://localhost:3100", ""));
  await expect(cp.getByText("Invoice INV-0001")).toBeVisible();

  // Unsubscribe from the reminder email link
  const unsub = String(reminder.text_body).match(/Unsubscribe: (http\S+)/)![1];
  await cp.goto(unsub.replace("http://localhost:3100", ""));
  await cp.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(cp.getByText("You're unsubscribed")).toBeVisible();
  await client.close();
  const consent = await sql("select action from consent_records order by created_at desc limit 1");
  expect(consent[0].action).toBe("unsubscribed");

  await page.goto(`/app/invoices/${invoiceId}`);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Mark as paid" }).click();
  await expect(page.getByText("Marked as paid")).toBeVisible();
  const status = await sql("select status from invoices where id = $1", [invoiceId]);
  expect(status[0].status).toBe("paid");
});

test("public pages, legal, help and changelog are live", async ({ page }) => {
  for (const p of ["/", "/pricing", "/help", "/help/webhook", "/help/licensing", "/help/refunds", "/help/white-label", "/legal/terms", "/legal/privacy", "/legal/dpa", "/legal/cookies", "/changelog", "/roadmap", "/status", "/compare"]) {
    const r = await page.goto(p);
    expect(r?.status(), p).toBe(200);
  }
  await page.goto("/pricing");
  await expect(page.getByText("$29").first()).toBeVisible();
});
