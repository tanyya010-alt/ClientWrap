import { expect, test } from "@playwright/test";
import http from "node:http";
import { appsumoWebhook, logIn, signUp, sql, uniqueEmail } from "./helpers";
import { MOCK_APPSUMO_PORT } from "../../playwright.config";

// Mock of AppSumo's OpenID endpoints: code "code-<licenseKey>" returns that license key.
let server: http.Server;
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url?.startsWith("/openid/token/")) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const b = JSON.parse(body);
        if (!String(b.code).startsWith("code-") || b.client_secret !== "e2e-client-secret") {
          res.statusCode = 400;
          return res.end('{"error":"invalid_grant"}');
        }
        res.end(JSON.stringify({ access_token: `at-${String(b.code).slice(5)}` }));
      });
      return;
    }
    const m = req.url?.match(/^\/openid\/license_key\/\?access_token=at-(.+)$/);
    if (m) return res.end(JSON.stringify({ license_key: decodeURIComponent(m[1]), status: "active" }));
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(MOCK_APPSUMO_PORT, "127.0.0.1", r));
});
test.afterAll(() => server.close());

async function purchase(request: any, key: string, tier: number) {
  expect((await appsumoWebhook(request, { event: "purchase", license_key: key, tier, license_status: "inactive" })).status()).toBe(200);
  expect((await appsumoWebhook(request, { event: "activate", license_key: key, tier, license_status: "active" })).status()).toBe(200);
}

test("new buyer: Activate on AppSumo → create account → tier applied (3 steps)", async ({ page, request }) => {
  const key = `e2e-new-${Date.now()}`;
  await purchase(request, key, 2);
  // Step 1: AppSumo redirects to our OAuth URL.
  await page.goto(`/api/appsumo/oauth?code=code-${key}`);
  await page.waitForURL("**/appsumo?step=account**");
  await expect(page.getByText("Step 2 of 3")).toBeVisible();
  // Step 2: create account.
  await page.getByRole("link", { name: /create account/ }).click();
  await expect(page.getByText("Your AppSumo license will be applied automatically")).toBeVisible();
  const email = uniqueEmail("sumo");
  await signUp(page, email);
  // Step 3: in the app with the tier applied.
  await page.waitForURL("**/onboarding");
  await page.goto("/app/billing");
  await expect(page.getByText("Growth", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("AppSumo lifetime license")).toBeVisible();
  const lic = await sql("select l.status, u.email from licenses l join users u on u.id = l.user_id where license_key = $1", [key]);
  expect(lic[0]).toMatchObject({ status: "active", email });
});

test("existing user: log in, then Activate applies the key; upgrade, downgrade, deactivate and reactivate", async ({ page, request }) => {
  const email = uniqueEmail("existing");
  await signUp(page, email);
  await page.waitForURL("**/onboarding");
  const key = `e2e-existing-${Date.now()}`;
  await purchase(request, key, 1);
  await page.goto(`/api/appsumo/oauth?code=code-${key}`);
  await page.waitForURL("**/app/billing?redeemed=redeemed");
  await expect(page.getByText("Your AppSumo license is active")).toBeVisible();
  await expect(page.locator("text=Solo").first()).toBeVisible();

  // Limits: Solo = 5 clients.
  await page.goto("/app/clients");
  await expect(page.getByText("0 of 5 client workspaces used")).toBeVisible();

  // Upgrade to tier 3.
  const up = `${key}-up`;
  expect((await appsumoWebhook(request, { event: "upgrade", license_key: up, prev_license_key: key, tier: 3, license_status: "active" })).status()).toBe(200);
  await page.goto("/app/clients");
  await expect(page.getByText("0 of 40 client workspaces used")).toBeVisible();

  // Downgrade to tier 2.
  const down = `${key}-down`;
  await appsumoWebhook(request, { event: "downgrade", license_key: down, prev_license_key: up, tier: 2, license_status: "active" });
  await page.goto("/app/clients");
  await expect(page.getByText("0 of 15 client workspaces used")).toBeVisible();

  // Deactivate (refund): read-only, export still works.
  await appsumoWebhook(request, { event: "deactivate", license_key: down, tier: 2, extra: { reason: "refund" } });
  await page.goto("/app");
  await expect(page.getByText("Your license was deactivated")).toBeVisible();
  const exp = await page.request.get("/api/export?format=json");
  expect(exp.status()).toBe(200);
  expect(await exp.json()).toHaveProperty("clients");
  await page.goto("/app/clients/new");
  await page.getByLabel("Client / company name").fill("Blocked Co");
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page.getByRole("alert")).toContainText("read-only");

  // Reactivate the same license: full access again.
  await appsumoWebhook(request, { event: "activate", license_key: down, tier: 2, license_status: "active" });
  await page.goto("/app");
  await expect(page.getByText("Your license was deactivated")).toHaveCount(0);
});

test("manual key entry, and refunded users are blocked from redeeming for 24h", async ({ page, request }) => {
  const email = uniqueEmail("manual");
  await signUp(page, email);
  await page.waitForURL("**/onboarding");
  const key = `e2e-manual-${Date.now()}`;
  await purchase(request, key, 1);
  await page.goto("/app/billing");
  await page.getByLabel("AppSumo license key").fill(key);
  await page.getByRole("button", { name: "Apply license" }).click();
  await expect(page.getByText("License applied")).toBeVisible();
  await appsumoWebhook(request, { event: "deactivate", license_key: key, tier: 1 });
  const key2 = `${key}-again`;
  await purchase(request, key2, 1);
  await page.goto("/app/billing");
  await page.getByLabel("AppSumo license key").fill(key2);
  await page.getByRole("button", { name: "Apply license" }).click();
  await expect(page.getByRole("alert")).toContainText("refunded recently");
});

test("admin support dashboard finds a license by key", async ({ page, request }) => {
  const key = `e2e-admin-${Date.now()}`;
  await purchase(request, key, 3);
  await signUp(page, "admin@e2e.test");
  await page.waitForURL("**/onboarding");
  await page.goto(`/admin?q=${key}`);
  await page.getByRole("link", { name: key }).click();
  await expect(page.getByText("Webhook & license event history (2)")).toBeVisible();
  await expect(page.getByText("Licenses are read-only here")).toBeVisible();
});
