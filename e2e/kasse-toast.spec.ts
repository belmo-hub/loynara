import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, request as apiRequest, test, type Page } from "@playwright/test";

// Design R4, r2 and r3 (23 Nov): a toast fired while the Kasse confirmation is open lives in that dialog: on top, clear of
// „Abbrechen“, its „×“ closes only the toast, and it outlives the dialog on „Abbrechen“ (which unmounts it) and on Esc,
// then times out. Nothing in the Kasse fires a toast yet, so the test calls the Kasse's own toast provider.
const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { cashierEmail: string; cashierPassword: string; cardToken: string };

/** Calls show() on the nearest toast provider above the open dialog (test only: no product code fires one yet). */
const fire = (page: Page, message: string) => page.evaluate(text => {
  const start = document.querySelector("dialog[open]")!;
  const key = Object.keys(start).find(name => name.startsWith("__reactFiber$"))!;
  type Fiber = { memoizedProps?: { value?: { show?: (message: string, options?: { tone: string }) => void } }; return: Fiber | null };
  for (let fiber = (start as unknown as Record<string, Fiber>)[key]; fiber; fiber = fiber.return!) {
    const show = fiber.memoizedProps?.value?.show;
    if (typeof show === "function") { show(text, { tone: "error" }); return; }
  }
  throw new Error("no toast provider above the dialog");
}, message);

test("a toast in the Kasse confirmation lives in it, keeps the dialog on ×, outlives Abbrechen and Esc, and times out", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const api = await apiRequest.newContext({ baseURL: origin });
  expect((await api.post("/api/auth/sign-in/email", { data: { email: demo.cashierEmail, password: demo.cashierPassword }, headers: { Origin: origin } })).ok()).toBe(true);
  await page.context().addCookies((await api.storageState()).cookies);
  await api.dispose();
  const card = await (await page.request.get(`/api/card/${demo.cardToken}`, { headers: { "sec-fetch-site": "same-origin" } })).json() as { cardLocator: string };

  const confirm = async () => {
    await page.getByRole("button", { name: /Stempel prüfen$/ }).click();
    await expect(page.locator("dialog[open]")).toBeVisible();
  };
  await page.goto("/cashier");
  await page.locator("#cashier-code").fill(card.cardLocator);
  await page.getByRole("button", { name: "Prüfen", exact: true }).click();
  await page.getByRole("button", { name: "Karte öffnen", exact: true }).click();
  await page.getByRole("button", { name: "Menge erhöhen", exact: true }).click();
  await confirm();

  const close = page.locator("button[aria-label='Hinweis schließen']");
  const cancel = page.locator("dialog[open]").getByRole("button", { name: "Abbrechen", exact: true });
  await fire(page, "Synthetischer Hinweis");
  await expect(close).toHaveCount(1);
  expect(await close.evaluate(button => !!button.closest("dialog[open]"))).toBe(true);
  // On top and clear of „Abbrechen“.
  expect(await close.evaluate(button => { const box = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })).toBe(true);
  const [toast, abbrechen] = [await close.locator("..").boundingBox(), await cancel.boundingBox()];
  expect(toast!.y >= abbrechen!.y + abbrechen!.height || toast!.y + toast!.height <= abbrechen!.y).toBe(true);
  // „×“ closes only the toast; the dialog stays and keeps the focus.
  await close.click();
  await expect(close).toHaveCount(0);
  await expect(page.locator("dialog[open]")).toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement?.closest("dialog[open]"))).toBe(true);

  // „Abbrechen“ unmounts the dialog: the toast stays, back on the page.
  await fire(page, "Synthetischer Hinweis zwei");
  await expect(close).toHaveCount(1);
  await cancel.click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(close).toBeVisible();
  await close.click();
  await expect(close).toHaveCount(0);

  // Esc closes the dialog while the toast's „×“ has the focus (which pauses it): the toast stays, then still times out on
  // its own (5 s), because the pause ended with the dialog.
  await confirm();
  await fire(page, "Synthetischer Hinweis drei");
  await expect(close).toHaveCount(1);
  await close.focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(close).toBeVisible();
  await page.mouse.move(0, 0); // nothing hovers the toast
  await expect(close).toHaveCount(0, { timeout: 10_000 });
});
