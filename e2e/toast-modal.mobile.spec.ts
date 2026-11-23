import { expect, test } from "@playwright/test";

// Design R4 and r2 (23 Nov): a toast fired while a modal is open lives in that modal: on top, tappable, its „×“ closes
// only the toast and gives the focus back to the modal, it leaves the modal's buttons free, and it outlives the modal
// even when the modal is unmounted while open (as the Kasse confirmation is on „Abbrechen“). Runs on the dev gallery.
test("a toast over an open dialog lives in it and outlives it", async ({ page, request }) => {
  test.skip((await request.get("/dev/design")).status() === 404, "design preview is development-only");
  await page.goto("/dev/design");
  await page.getByRole("button", { name: "Dialog öffnen" }).click();
  const fire = () => page.evaluate(() => [...document.querySelectorAll("button")].find(button => button.textContent === "Fehlerhinweis")!.click());
  const close = page.locator("button[aria-label='Hinweis schließen']");
  await fire();
  await expect(close).toHaveCount(1);
  expect(await close.evaluate(button => !!button.closest("dialog[open]"))).toBe(true);
  // Tappable, and clear of the dialog's own buttons.
  expect(await close.evaluate(button => { const box = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })).toBe(true);
  expect(await page.evaluate(() => {
    const toast = document.querySelector("button[aria-label='Hinweis schließen']")!.parentElement!.getBoundingClientRect();
    return [...document.querySelectorAll("dialog[open] button")].filter(button => !button.closest("[popover]")).every(button => { const box = button.getBoundingClientRect(); return box.bottom <= toast.top || box.top >= toast.bottom; });
  })).toBe(true);
  await close.click();
  await expect(close).toHaveCount(0);
  expect(await page.evaluate(() => !!document.querySelector("dialog[open]") && !!document.activeElement?.closest("dialog[open]"))).toBe(true);
  // The dialog unmounted while open: the toast stays, back on the page.
  await fire();
  await expect(close).toHaveCount(1);
  await page.evaluate(() => document.querySelector("dialog[open]")!.remove());
  await expect(close).toBeVisible();
  expect(await close.evaluate(button => !button.closest("dialog"))).toBe(true);
});
