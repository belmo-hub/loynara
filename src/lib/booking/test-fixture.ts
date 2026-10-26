// Shared set-up for the booking integration tests (pattern of award-key-race.integration.test.ts). Not imported by app code.
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect } from "vitest";
import { pool } from "@/db";
import type { WorkingDay } from "@/db/schema";
import { auth } from "@/lib/auth";
import { assertDisposableDatabase, assertLocalTestDatabaseUrl } from "@/lib/disposable-test-database";
import { createMerchant, enroll } from "@/lib/product";
import { selectionCookieName } from "@/lib/locations";
import { getSetup, saveSetup } from "./setup";

export const origin = "http://localhost:3000";

/** Truncates before every test and lets the fixture register identities, restoring the registration switch afterwards. */
export function withBookingDatabase() {
  assertLocalTestDatabaseUrl();
  const registration = process.env.PUBLIC_REGISTRATION_ENABLED;
  beforeEach(async () => { await assertDisposableDatabase(pool); await pool.query('TRUNCATE tenants,"user" CASCADE'); process.env.PUBLIC_REGISTRATION_ENABLED = "true"; });
  afterAll(async () => { if (registration === undefined) delete process.env.PUBLIC_REGISTRATION_ENABLED; else process.env.PUBLIC_REGISTRATION_ENABLED = registration; await pool.end(); });
}

export function request(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  return new Request(origin + path, { method: init.method ?? (init.body === undefined ? "GET" : "POST"), headers: { origin, "content-type": "application/json", cookie: init.cookie ?? "" }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

export async function identity() {
  const email = `${randomUUID()}@example.test`, password = `Local!${randomUUID()}Aa`;
  const user = await auth.api.signUpEmail({ body: { name: "Synthetic booking identity", email, password } });
  const signIn = await auth.handler(request("/api/auth/sign-in/email", { body: { email, password } }));
  expect(signIn.status).toBe(200);
  return { userId: user.user.id, email, cookie: signIn.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
}

export const allWeek = (start = "00:00", end = "24:00"): WorkingDay[] => [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, start, end, breaks: [] }));

/** A Berlin shop with booking enabled, one 30-minute service (25 €), one staff member and one card. */
export async function bookingShop(options: { programType?: "stamp" | "points"; workingHours?: WorkingDay[]; autoConfirm?: boolean } = {}) {
  const owner = await identity();
  const points = options.programType === "points";
  const merchant = await createMerchant({ userId: owner.userId, businessName: "Synthetic Barber", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic programme",
    programType: points ? "points" : "stamp", ...(points ? { earningMode: "purchase" as const, pointsPerCurrencyUnit: 3 } : {}), rulesText: "Synthetic booking rules text", rewardTitle: "Reward", rewardCost: 10 });
  const scope = { tenantId: merchant.tenantId, locationId: merchant.locationId };
  await saveSetup(scope, {
    settings: { shopType: "barber", leadTimeMin: 120, maxDaysAhead: 42, cancelDeadlineHours: 24, maxReschedulesPerMonth: 2, autoConfirm: options.autoConfirm ?? true, noShowBlockAfter: 3, maxOpenPerCard: 2 },
    services: [{ name: "Haarschnitt", durationMin: 30, priceMinor: 2500 }],
    staff: [{ name: "Lena", workingHours: options.workingHours ?? allWeek() }],
  });
  await pool.query("UPDATE booking_settings SET enabled = true WHERE tenant_id = $1", [merchant.tenantId]);
  const setup = await getSetup(scope);
  const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  return { owner, merchant, scope, serviceId: setup.services[0].id, staffId: setup.staff[0].id, card, ownerCookie: `${owner.cookie}; ${selectionCookieName(owner.userId)}=${merchant.locationId}` };
}
