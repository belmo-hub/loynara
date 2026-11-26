import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { signUp } from "./support/sign-up";

// ENG-381: in WebKit a screen opened from a row low in a list kept the list's scroll. A shorter screen then sat past its
// end, half empty, with its save button out of reach (Programm → „Geburtstag“ and ten other screens; Design, 25 Nov).
// Playwright's WebKit shows it without the phone emulation (isMobile), at the phone's width; with it, it does not.
test.use({ viewport: { width: 390, height: 844 }, isMobile: false, hasTouch: false });
test("a screen opened from low in Programm opens at its top, with its save button in reach", async ({ page, browserName }) => {
  // A local guard: the bug is WebKit's, and CI has no WebKit, so the Chrome phone project proves nothing here.
  test.skip(browserName !== "webkit", "WebKit only");
  const origin = new URL(test.info().project.use.baseURL!).origin;
  if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("Requires the synthetic local app");
  const email = `scroll-${randomUUID()}@example.test`, password = `Local!${randomUUID()}Aa`;
  const request = page.context().request;
  expect((await signUp(request, { headers: { Origin: origin }, data: { name: "Synthetic scroll owner", email, password } })).status()).toBe(200);
  expect((await request.post("/api/merchant/onboard", { headers: { Origin: origin }, data: { businessName: "Synthetic Scroll Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Scroll card", programType: "stamp", rulesText: "Synthetic local test only.", rewardTitle: "Kaffee", rewardCost: 5 } })).status()).toBe(201);

  await page.goto("/merchant/program");
  const row = page.getByRole("link", { name: /Geburtstag/ });
  await row.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -160));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  await row.click();
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(/Programm/);
  await page.waitForFunction(() => !document.getAnimations().some(animation => animation.playState !== "finished" && (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition")));

  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const save = page.getByRole("button", { name: "Speichern", exact: true });
  await expect(save).toBeInViewport();
  // Not just painted there: a tap at its centre reaches it.
  expect(await save.evaluate(button => { const box = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })).toBe(true);
});
