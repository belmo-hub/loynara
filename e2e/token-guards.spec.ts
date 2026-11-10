import { expect, test } from "@playwright/test";

// G-10: a link opened without its token can only fail, so these pages show the invalid state and no action button.
for (const [path, action] of [["/unsubscribe", "Angebote abbestellen"], ["/recover/confirm", "Meine Karten anzeigen"]] as const) {
  test(`${path} without a token shows „Link unvollständig“ and no ${action} button`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Link unvollständig", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: action })).toHaveCount(0);
  });
  test(`${path} with a token still offers ${action}`, async ({ page }) => {
    await page.goto(`${path}#token=synthetic_token_value`);
    await expect(page.getByRole("button", { name: action })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Link unvollständig" })).toHaveCount(0);
  });
}

test("/unsubscribe posts the token from its link, also when effects run twice in development", async ({ page }) => {
  let posted: unknown;
  await page.route("**/api/unsubscribe", async route => { posted = route.request().postDataJSON(); await route.fulfill({ json: { ok: true } }); });
  await page.goto("/unsubscribe#token=synthetic_token_value");
  await page.getByRole("button", { name: "Angebote abbestellen" }).click();
  await expect(page.getByRole("heading", { name: "Abgemeldet", exact: true })).toBeVisible();
  expect(posted).toEqual({ token: "synthetic_token_value" });
});
