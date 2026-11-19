import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type APIRequestContext } from "@playwright/test";

// Design #300: with rewards at 3 and 8, a 2 → 3 booking lands on the 3-slot card; when the moment ends the card counts to
// 8. That change is a crossfade with the card's height eased, so the ticket below slides instead of jumping 61 px.
let owner: APIRequestContext, guest: APIRequestContext, cardToken: string, membershipId: string;
test.beforeAll(async ({ baseURL }) => {
  const url = baseURL ?? "http://localhost:3000", options = { baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } };
  owner = await apiRequest.newContext(options); guest = await apiRequest.newContext(options);
  expect((await owner.post("/api/auth/sign-up/email", { data: { name: "Synthetic goal owner", email: `owner-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  const setup = await owner.post("/api/merchant/onboard", { data: { businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "One confirmed visit", rewardTitle: "Gratiskaffee", rewardCost: 8 } });
  expect(setup.status()).toBe(201);
  const { programSlug } = await setup.json() as { programSlug: string };
  expect((await owner.post("/api/merchant/program/rewards", { data: { action: "create", programSlug, title: "Kleiner Kaffee", cost: 3, termsText: "Ein kleiner Kaffee." } })).status()).toBe(201);
  const joined = await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false } });
  expect(joined.status()).toBe(201);
  ({ cardToken } = await joined.json() as { cardToken: string });
  const { scanCode } = await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string };
  ({ membershipId } = await (await owner.get(`/api/cashier/lookup?code=${encodeURIComponent(scanCode)}`)).json() as { membershipId: string });
});
test.afterAll(async () => { await owner.dispose(); await guest.dispose(); });

const award = async (quantity: number) => expect((await owner.post("/api/cashier/award", { data: { membershipId, quantity, idempotencyKey: randomUUID(), requestId: randomUUID() } })).status()).toBe(200);

test("the goal released after a booking moment slides the ticket instead of jumping it", async ({ browser, baseURL }) => {
  // The moment plays only with STAMP_ANIMATION_ENABLED on the server; its card read then carries stampMoment.
  test.skip(!("stampMoment" in await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json()), "the booking moment is off on this server");
  await award(2);
  const page = await (await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(`/card/${cardToken}`);
  await expect(page.getByRole("img", { name: "2 von 3 Stempeln", exact: true })).toBeVisible();
  const ticket = page.locator(".customer-qr-panel");
  // Every frame's ticket top, from before the booking until after the release.
  await ticket.evaluate(node => {
    const tops: number[] = [];
    (window as unknown as { tops: number[] }).tops = tops;
    const look = () => { tops.push(node.getBoundingClientRect().top + window.scrollY); requestAnimationFrame(look); };
    look();
  });
  await award(1);
  await page.getByRole("button", { name: "Karte aktualisieren" }).click();
  await expect(page.getByRole("img", { name: "3 von 3 Stempeln", exact: true })).toBeVisible(); // the stamp lands on the held card
  // The ready band opens with the stamp; once it has, only the release is traced.
  await page.waitForTimeout(1500);
  await expect(page.getByRole("img", { name: "3 von 3 Stempeln", exact: true })).toBeVisible();
  await page.evaluate(() => { (window as unknown as { tops: number[] }).tops.length = 0; });
  await expect(page.getByRole("img", { name: "3 von 8 Stempeln", exact: true })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
  const tops = await page.evaluate(() => (window as unknown as { tops: number[] }).tops);
  const steps = tops.slice(1).map((top, i) => Math.abs(top - tops[i]));
  const move = tops.at(-1)! - tops[0];
  expect(move, "the taller card moved the ticket down").toBeGreaterThan(40);
  // The height eases over --dur-ui: the move is spread over frames, never one cut.
  expect(Math.max(...steps), `largest per-frame step of the ${move} px move`).toBeLessThan(move / 2);
  expect(steps.filter(step => step > 0.5).length, "frames the ticket moved in").toBeGreaterThanOrEqual(5);
  expect(await page.locator("[aria-hidden=true][inert]").count(), "the faded card is removed").toBe(0);
});
