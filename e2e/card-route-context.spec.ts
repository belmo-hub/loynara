import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { auth } from "../src/lib/auth";
import { pool } from "../src/db";
import { createMerchant, enroll } from "../src/lib/product";

const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || target.hostname !== "localhost" || target.port !== "55433"
  || !/^\/looplocal_wallet_route_116_[a-f0-9]{12}$/.test(target.pathname)) throw new Error("Unique owned disposable route database required");
test.afterAll(async () => { await pool.end(); });

test("supported private-card URL navigation replaces the document and shows the new membership context", async ({ browser, baseURL }) => {
  expect(baseURL).toBe("http://localhost:3000");
  expect((await pool.query("SHOW data_directory")).rows[0].data_directory).toBe("/private/tmp/loynara-goal-133-pg");
  expect((await pool.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count).toBe(25);
  const cards = [];
  for (const name of ["Synthetic route A", "Synthetic route B"]) {
    const user = (await auth.api.signUpEmail({ body: { name: "Synthetic route owner", email: `route-${randomUUID()}@example.test`, password: `Synthetic!${randomUUID()}Aa` } })).user;
    const merchant = await createMerchant({ userId: user.id, businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic route", programType: "stamp", rulesText: "Synthetic approved checkout", rewardTitle: "Synthetic reward", rewardCost: 5 });
    cards.push(await enroll({ slug: merchant.programSlug, acceptedTerms: true }));
  }
  const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 900 } });
  try {
    const page = await context.newPage();
    await page.goto(`/card/${cards[0].cardToken}`);
    await expect(page.getByRole("heading", { name: "Synthetic route A", exact: true })).toBeVisible();
    const firstDocument = await page.evaluate(() => performance.timeOrigin);
    // Genuine private URL navigation, not an injected router or manufactured token-prop transition.
    await page.goto(`/card/${cards[1].cardToken}`);
    await expect(page.getByRole("heading", { name: "Synthetic route B", exact: true })).toBeVisible();
    expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(firstDocument);
    await expect(page.getByRole("heading", { name: "Synthetic route A", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Meine Kartendaten exportieren", exact: true })).toHaveAttribute("href", `/api/card/${cards[1].cardToken}/export`);
  } finally { await context.close(); }
});
