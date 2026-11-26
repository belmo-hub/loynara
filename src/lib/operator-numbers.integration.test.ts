import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { programs, shopErasures, subscriptions, tenants } from "@/db/schema";
import { auth } from "./auth";
import { operatorOverview } from "./operator";
import { createMerchant } from "./product";
import { planCharge } from "./stripe-config";
import { assertDisposableDatabase, assertLocalTestDatabaseUrl } from "./disposable-test-database";

assertLocalTestDatabaseUrl();
const registration = process.env.PUBLIC_REGISTRATION_ENABLED;
beforeEach(async () => { await assertDisposableDatabase(pool); await pool.query('TRUNCATE tenants, "user", shop_erasures CASCADE'); process.env.PUBLIC_REGISTRATION_ENABLED = "true"; });
afterAll(async () => {
  if (registration === undefined) delete process.env.PUBLIC_REGISTRATION_ENABLED; else process.env.PUBLIC_REGISTRATION_ENABLED = registration;
  await pool.end();
});

const DAY = 86_400_000;
let made = 0; // shop names are letters: digits could read as a phone number to the shop-name check
async function shop(subscription: Partial<typeof subscriptions.$inferInsert> | null) {
  const email = `${randomUUID()}@example.test`;
  const { user } = await auth.api.signUpEmail({ body: { name: "Synthetic owner", email, password: "Synthetic-Numbers-384-Only!" } });
  const { tenantId } = await createMerchant({ userId: user.id, businessName: `Laden ${String.fromCharCode(65 + made++)}`, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Zahlen", programType: "stamp", rulesText: "Synthetic local test only.", rewardTitle: "Kaffee", rewardCost: 5 });
  if (subscription === null) await db.delete(subscriptions).where(eq(subscriptions.tenantId, tenantId));
  else if (Object.keys(subscription).length) await db.update(subscriptions).set(subscription).where(eq(subscriptions.tenantId, tenantId));
  return tenantId;
}

// ENG-384: the founder's numbers at the top of /operator. One shop per state, plus a demo shop and an erased one that never count.
it("counts every shop once by billing state, with the month's revenue from the billing code's own price", async () => {
  const operator = (await auth.api.signUpEmail({ body: { name: "Synthetic operator", email: `${randomUUID()}@example.test`, password: "Synthetic-Numbers-384-Only!" } })).user.id;
  const now = Date.now();
  await shop({ status: "active", freeUntil: new Date(now + 10 * DAY) }); // im Gratismonat
  await shop({ status: "active", freeUntil: new Date(now - 3 * DAY), activeLocationCount: 2 }); // zahlend, two locations
  const old = await shop({ status: "active" }); // zahlend, no free month, older than a week
  await shop({ status: "past_due", freeUntil: new Date(now - 40 * DAY) }); // Zahlung fehlgeschlagen
  await shop({}); // offen: manual_pending, as created
  await shop({ status: "pending_checkout" }); // offen
  await shop(null); // offen: no subscription row
  const cancelled = await shop({ status: "cancelled" }); // beendet, and its programme ended: not live
  await shop({ status: "suspended" }); // beendet
  const demo = await shop({ status: "active" });
  const erased = await shop({ status: "active" });
  await db.update(tenants).set({ createdAt: new Date(now - 30 * DAY) }).where(eq(tenants.id, old));
  await db.update(programs).set({ status: "ended" }).where(eq(programs.tenantId, cancelled));
  await db.update(tenants).set({ slug: `demo-${randomUUID()}` }).where(eq(tenants.id, demo));
  await db.insert(shopErasures).values({ erasedTenantId: erased, legalName: "Synthetic", endDate: "2026-11-01", exportUntil: "2026-12-01", actorUserId: operator, contract: {}, rowCounts: {}, external: {}, confirmationSendableAt: new Date() });

  const { numbers } = await operatorOverview(operator, { PLATE_OPERATOR_USER_IDS: operator });
  const monthly = planCharge({ activeLocationCount: 2, currency: "EUR" })!.totalMinor + planCharge({ activeLocationCount: 1, currency: "EUR" })!.totalMinor;
  expect(numbers).toEqual({ shops: 9, live: 8, freeMonth: 1, paying: 2, failed: 1, open: 3, ended: 2, newThisWeek: 8, monthlyMinor: monthly });
  expect(monthly).toBe(14_700); // 3 locations × 49 €
});

it("is the operator's alone", async () => {
  const owner = (await auth.api.signUpEmail({ body: { name: "Synthetic owner", email: `${randomUUID()}@example.test`, password: "Synthetic-Numbers-384-Only!" } })).user.id;
  await expect(operatorOverview(owner, { PLATE_OPERATOR_USER_IDS: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
});
