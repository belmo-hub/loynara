import { expect, test } from "@playwright/test";
import { smallTargets } from "./support/targets";

// /operator: a plain 404 for everyone but the operator, and a phone layout (375 px) with nothing sideways and
// touch targets of at least 44 px. The operator half needs a server started with PLATE_OPERATOR_USER_IDS set to that
// account's id, so it runs only when OPERATOR_E2E_EMAIL and OPERATOR_E2E_PASSWORD are given.
test.use({ viewport: { width: 375, height: 812 } });

test("a visitor who is not signed in gets the ordinary 404", async ({ page }) => {
  const res = await page.goto("/operator");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("Platte scannen")).toHaveCount(0);
  expect((await page.request.post("/api/operator/plate", { data: {}, headers: { Origin: new URL(page.url()).origin } })).status()).toBe(404);
});

test("the operator page fits a 375 px phone", async ({ page }) => {
  const email = process.env.OPERATOR_E2E_EMAIL, password = process.env.OPERATOR_E2E_PASSWORD;
  test.skip(!email || !password, "needs an operator account on a server that lists it");
  const origin = new URL(test.info().project.use.baseURL!).origin;
  expect((await page.request.post("/api/auth/sign-in/email", { data: { email, password }, headers: { Origin: origin } })).ok()).toBe(true);
  const res = await page.goto("/operator");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("button", { name: "Platte scannen" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  expect(await smallTargets(page, {})).toEqual([]);
  const plate = page.getByRole("button", { name: /P-\d+/ }).first();
  if (await plate.count()) {
    await plate.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  }
});
