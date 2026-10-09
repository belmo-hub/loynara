import { expect, test } from "@playwright/test";

test.use({ actionTimeout: 10_000 });
for (const kind of ["verify", "recover"] as const) {
  test(`${kind}: a delayed old response cannot consume a later email link in the same tab`, async ({ page }) => {
    const path = kind === "verify" ? "/verify-email" : "/recover/confirm";
    const api = kind === "verify" ? "/api/contact/verify" : "/api/recover/confirm";
    const action = kind === "verify" ? "E-Mail-Adresse bestätigen" : "Meine Karten anzeigen";
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const firstStarted = new Promise<void>(resolve => { started = resolve; });
    const tokens: string[] = [];
    await page.route(`**${api}`, async route => {
      const token = route.request().postDataJSON().token;
      tokens.push(token);
      if (token === "synthetic_A") { started(); await gate; }
      await route.fulfill({ json: kind === "verify" ? { verified:true } : { cards:[{ membershipId:token,merchantName:token,programmeName:"Synthetic" }] } });
    });
    await page.goto(`${path}#token=synthetic_A`);
    await page.getByRole("button", { name:action,exact:true }).click();
    await firstStarted;
    await page.evaluate(() => { window.location.hash = "token=synthetic_B"; });
    await expect(page.getByRole("button", { name:action,exact:true })).toBeEnabled();
    const completed = page.waitForResponse(response => response.url().endsWith(api));
    release(); await completed;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.getByRole("button", { name:action,exact:true })).toBeVisible();
    await page.getByRole("button", { name:action,exact:true }).click();
    if (kind === "verify") await expect(page.getByRole("heading", { name:"E-Mail bestätigt." })).toBeVisible();
    else await expect(page.locator(".recovery-options")).toContainText("synthetic_B");
    expect(tokens).toEqual(["synthetic_A", "synthetic_B"]);
  });
}
