import { expect, test } from "@playwright/test";
import { latestEmail, signUp, sql, uniqueEmail, verifyEmail } from "./helpers";

test("a new user finishes guided onboarding and sends a first wrap well under 15 minutes", async ({ page }) => {
  const started = Date.now();
  const email = uniqueEmail("onboard");
  await signUp(page, email);
  await page.waitForURL("**/onboarding");
  await verifyEmail(page, email);

  await page.goto("/onboarding?step=1");
  await page.getByLabel("Business name (what clients see)").fill("Pat's SEO Studio");
  await page.getByText("SEO", { exact: true }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.waitForURL("**/onboarding?step=2");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.waitForURL("**/onboarding?step=3");
  await page.getByLabel("Client name").fill("Acme Plumbing");
  await page.getByLabel("Contact name").fill("Jo Client");
  await page.getByLabel("Contact email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();

  await page.waitForURL("**/onboarding?step=4");
  const inputs = page.locator("input[name^='cur__']");
  const prev = page.locator("input[name^='prev__']");
  await prev.nth(0).fill("4200");
  await inputs.nth(0).fill("5100");
  await prev.nth(2).fill("20");
  await inputs.nth(2).fill("31");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.waitForURL("**/onboarding?step=5");
  await page.getByRole("button", { name: "Generate wrap" }).click();
  await expect(page.getByText("Organic sessions").first()).toBeVisible();
  await expect(page.getByLabel("What changed (edit freely)")).toHaveValue(/5,100/);
  await page.getByLabel(/Send to /).check();
  await page.getByRole("button", { name: "Send my first wrap" }).click();

  await page.waitForURL("**/onboarding?step=6");
  await expect(page.getByText("You sent your first wrap")).toBeVisible();
  const mail = await latestEmail(email, "your");
  expect(mail.subject).toContain("Acme Plumbing");
  expect(mail.html).toContain("/p/");
  const report = await sql("select status from reports r join clients c on c.id = r.client_id where c.name = 'Acme Plumbing'");
  expect(report[0].status).toBe("sent");
  expect(Date.now() - started).toBeLessThan(15 * 60_000);

  // The client's results link works without login and shows the wrap.
  const portal = String(mail.text_body).match(/http:\/\/localhost:3100\/p\/\S+/)![0];
  const client = await page.context().browser()!.newContext();
  const pp = await client.newPage();
  await pp.goto(portal.replace("http://localhost:3100", "http://localhost:3100"));
  await expect(pp.getByRole("heading", { name: "Acme Plumbing" })).toBeVisible();
  await expect(pp.getByText("Suggested next step")).toBeVisible();
  await client.close();
});

test("one-click demo workspace loads sample data that doesn't count toward limits", async ({ page }) => {
  const email = uniqueEmail("demo");
  await signUp(page, email);
  await page.waitForURL("**/onboarding");
  await page.getByRole("button", { name: "Load demo workspace" }).click();
  await page.waitForURL("**/app?demo=1");
  await expect(page.getByText("Demo workspace loaded")).toBeVisible();
  await page.goto("/app/clients");
  await expect(page.getByText("Northwind Bakery")).toBeVisible();
  await expect(page.getByText("0 of 1 client workspaces used")).toBeVisible();
});
