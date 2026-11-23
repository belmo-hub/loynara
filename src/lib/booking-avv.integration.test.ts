import { afterAll, expect, it } from "vitest";
import { pool } from "@/db";
import { POST as acceptRoute } from "@/app/api/merchant/booking/avv/route";
import { GET as meRoute } from "@/app/api/me/route";
import { POST as toggleRoute } from "@/app/api/operator/booking/route";
import { BOOKING_AVV_ACCEPTANCE_TEXT_VERSION, BOOKING_AVV_OWNER_ONLY } from "./booking-avv";

import { bookingShop, identity, origin, request, withBookingDatabase } from "./booking/test-fixture";
import { OWNER_AVV, OWNER_TERMS } from "./owner-contract";
import { OWNER_PRIVACY_NOTICE } from "./owner-privacy";

// ENG-339 (Legal 22 Nov, founder Q-113): an existing shop accepts the AVV Fassung with Terminbuchung in the app.
withBookingDatabase();
const saved = process.env.PLATE_OPERATOR_USER_IDS;
afterAll(() => { if (saved === undefined) delete process.env.PLATE_OPERATOR_USER_IDS; else process.env.PLATE_OPERATOR_USER_IDS = saved; });

const acceptedAt = async (cookie: string) => ((await (await meRoute(request("/api/me", { cookie }))).json()) as { bookingContractsAcceptedAt?: string | null }).bookingContractsAcceptedAt;
const accept = (cookie: string) => acceptRoute(request("/api/merchant/booking/avv", { method: "POST", body: {}, cookie }));
const rows = async (tenantId: string) => (await pool.query("SELECT user_id, tenant_id, path, terms_version, avv_version, privacy_version, text_version, accepted_at FROM owner_acceptances WHERE tenant_id = $1 ORDER BY accepted_at", [tenantId])).rows;
/** bookingShop switches booking on directly; these tests start from a shop the operator has not switched on yet. */
async function shopWithoutBooking() {
  const shop = await bookingShop();
  await pool.query("UPDATE booking_settings SET enabled = false WHERE location_id = $1", [shop.scope.locationId]);
  return shop;
}
/** As every shop from before 29 Nov: its sign-up row, business attached at setup, on the older Fassungen (Reviewer N-1). */
async function shopOnOlderFassung() {
  const shop = await shopWithoutBooking();
  await pool.query("INSERT INTO owner_acceptances (user_id, tenant_id, terms_version, avv_version, privacy_version, text_version) VALUES ($1, $2, '2026-11-22', '2026-11-20', '2026-11-20', '2026-11-20')", [shop.owner.userId, shop.scope.tenantId]);
  return shop;
}
const bookingRows = async (tenantId: string) => (await pool.query("SELECT count(*)::int AS n FROM owner_acceptances WHERE tenant_id = $1 AND path = 'booking'", [tenantId])).rows[0].n;

// The dialog's wording of Legal § 6 is version 2026-11-24; a new wording takes a new date here and in booking-avv.ts.
it("the acceptance text version is the one for Legal § 6's wording", () => expect(BOOKING_AVV_ACCEPTANCE_TEXT_VERSION).toBe("2026-11-24"));

it("a shop on the older Fassungen (the real case) can accept: one booking row, and /api/me then says when (Reviewer W1)", async () => {
  const shop = await shopOnOlderFassung();
  expect(await acceptedAt(shop.ownerCookie)).toBeNull();
  const res = await accept(shop.ownerCookie);
  expect(res.status).toBe(200);
  expect((await res.json() as { acceptedAt: string | null }).acceptedAt).toEqual(expect.any(String));
  expect(await bookingRows(shop.scope.tenantId)).toBe(1);
});

it("an owner whose role was switched off is refused and nothing is written (Reviewer W3)", async () => {
  const shop = await shopOnOlderFassung();
  await pool.query("UPDATE staff_roles SET active = false WHERE user_id = $1", [shop.owner.userId]);
  expect((await accept(shop.ownerCookie)).status).toBe(403);
  expect(await bookingRows(shop.scope.tenantId)).toBe(0);
});

it("two acceptances that reach the check at the same moment write one row: the business row lock orders them", async () => {
  const shop = await shopOnOlderFassung();
  // Hold every reader of owner_acceptances back, so both requests arrive at the repeat check together. Without the lock on
  // the business row both then see no booking row and both write one; with it the second waits and sees the first's.
  const holder = await pool.connect();
  try {
    await holder.query("BEGIN");
    await holder.query("LOCK TABLE owner_acceptances IN ACCESS EXCLUSIVE MODE");
    const both = Promise.all([accept(shop.ownerCookie), accept(shop.ownerCookie)]);
    await expect.poll(async () => (await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> $1", [(holder as unknown as { processID: number }).processID])).rows[0].n, { timeout: 10_000 }).toBe(2);
    await holder.query("COMMIT");
    expect((await both).map(res => res.status)).toEqual([200, 200]);
  } finally { holder.release(); }
  expect(await bookingRows(shop.scope.tenantId)).toBe(1);
});

it("one owner may try at most 10 times in 15 minutes", async () => {
  const shop = await shopOnOlderFassung();
  for (let attempt = 0; attempt < 10; attempt += 1) expect((await accept(shop.ownerCookie)).status).toBe(200);
  const refused = await accept(shop.ownerCookie);
  expect(refused.status).toBe(429);
  expect(await bookingRows(shop.scope.tenantId)).toBe(1);
});

it("the owner accepts once: one append-only row with both Fassungen (terms and AVV), and the operator's switch then works", async () => {
  const operator = await identity(), shop = await shopWithoutBooking();
  process.env.PLATE_OPERATOR_USER_IDS = operator.userId;
  const toggle = () => toggleRoute(request("/api/operator/booking", { body: { ...shop.scope, enabled: true }, cookie: operator.cookie }));
  // bookingShop's owner has no acceptance row at all, so /api/me says not yet.
  expect(await acceptedAt(shop.ownerCookie)).toBeNull();
  expect((await toggle()).status).toBe(409);

  const res = await accept(shop.ownerCookie);
  expect(res.status).toBe(200);
  const answer = await res.json() as { acceptedAt: string };
  expect(answer).toEqual({ acceptedAt: expect.any(String) });
  expect(await acceptedAt(shop.ownerCookie)).toBe(answer.acceptedAt);
  expect(await rows(shop.scope.tenantId)).toEqual([{ user_id: shop.owner.userId, tenant_id: shop.scope.tenantId, path: "booking", terms_version: OWNER_TERMS.version,
    avv_version: OWNER_AVV.version, privacy_version: OWNER_PRIVACY_NOTICE.version, text_version: "2026-11-24", accepted_at: expect.any(Date) }]);
  expect((await toggle()).status).toBe(200);

  // A second tap, or two at once, adds nothing.
  await Promise.all([accept(shop.ownerCookie), accept(shop.ownerCookie)]);
  expect(await rows(shop.scope.tenantId)).toHaveLength(1);
});

it("only the Inhaberkonto can accept: a manager and a cashier are refused and nothing is written", async () => {
  const shop = await shopWithoutBooking();
  for (const role of ["manager", "cashier"]) {
    const staff = await identity();
    await pool.query("INSERT INTO staff_roles (tenant_id, user_id, role, location_id) VALUES ($1, $2, $3, $4)", [shop.scope.tenantId, staff.userId, role, shop.scope.locationId]);
    const res = await accept(staff.cookie);
    expect(res.status).toBe(403);
    // Staff never see the contract state: /api/me carries it for the owner only.
    expect(await acceptedAt(staff.cookie)).toBeUndefined();
    expect(await res.json()).toMatchObject({ error: BOOKING_AVV_OWNER_ONLY });
  }
  const stranger = await identity();
  expect((await accept(stranger.cookie)).status).toBe(403);
  expect(await rows(shop.scope.tenantId)).toEqual([]);
});

it("refuses a request from another origin and one without a session", async () => {
  const shop = await shopWithoutBooking();
  const foreign = new Request(`${origin}/api/merchant/booking/avv`, { method: "POST", headers: { origin: "https://evil.example", cookie: shop.ownerCookie, "content-type": "application/json" }, body: "{}" });
  expect((await acceptRoute(foreign)).status).toBe(403);
  expect((await accept("")).status).toBe(401);
  expect(await rows(shop.scope.tenantId)).toEqual([]);
});

it("an accepted row stays append-only, and a booking row without its business is refused by the database", async () => {
  const shop = await shopWithoutBooking();
  await accept(shop.ownerCookie);
  await expect(pool.query("UPDATE owner_acceptances SET avv_version = '2099-01-01' WHERE tenant_id = $1", [shop.scope.tenantId])).rejects.toThrow(/append-only/);
  await expect(pool.query("DELETE FROM owner_acceptances WHERE tenant_id = $1", [shop.scope.tenantId])).rejects.toThrow(/append-only/);
  await expect(pool.query("INSERT INTO owner_acceptances (user_id, path, terms_version, avv_version, privacy_version, text_version) VALUES ($1, 'booking', 'x', 'x', 'x', 'x')", [shop.owner.userId]))
    .rejects.toThrow(/owner_acceptances_path_valid/);
  await expect(pool.query("INSERT INTO owner_acceptances (user_id, tenant_id, path, terms_version, avv_version, privacy_version, text_version) VALUES ($1, $2, 'other', 'x', 'x', 'x', 'x')", [shop.owner.userId, shop.scope.tenantId]))
    .rejects.toThrow(/owner_acceptances_path_valid/);
});
