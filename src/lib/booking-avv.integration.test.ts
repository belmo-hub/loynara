import { afterAll, expect, it } from "vitest";
import { pool } from "@/db";
import { GET as statusRoute, POST as acceptRoute } from "@/app/api/merchant/booking/avv/route";
import { POST as toggleRoute } from "@/app/api/operator/booking/route";
import { BOOKING_AVV_ACCEPTANCE_TEXT_VERSION, BOOKING_AVV_OWNER_ONLY } from "./booking-avv";
import { bookingShop, identity, origin, request, withBookingDatabase } from "./booking/test-fixture";
import { OWNER_AVV, OWNER_TERMS } from "./owner-contract";
import { OWNER_PRIVACY_NOTICE } from "./owner-privacy";

// ENG-339 (Legal 22 Nov, founder Q-113): an existing shop accepts the AVV Fassung with Terminbuchung in the app.
withBookingDatabase();
const saved = process.env.PLATE_OPERATOR_USER_IDS;
afterAll(() => { if (saved === undefined) delete process.env.PLATE_OPERATOR_USER_IDS; else process.env.PLATE_OPERATOR_USER_IDS = saved; });

const status = async (cookie: string) => (await statusRoute(request("/api/merchant/booking/avv", { cookie }))).json();
const accept = (cookie: string) => acceptRoute(request("/api/merchant/booking/avv", { method: "POST", body: {}, cookie }));
const rows = async (tenantId: string) => (await pool.query("SELECT user_id, tenant_id, path, terms_version, avv_version, privacy_version, text_version, accepted_at FROM owner_acceptances WHERE tenant_id = $1 ORDER BY accepted_at", [tenantId])).rows;
/** bookingShop switches booking on directly; these tests start from a shop the operator has not switched on yet. */
async function shopWithoutBooking() {
  const shop = await bookingShop();
  await pool.query("UPDATE booking_settings SET enabled = false WHERE location_id = $1", [shop.scope.locationId]);
  return shop;
}

it("the owner accepts once: one append-only row with both Fassungen (terms and AVV), and the operator's switch then works", async () => {
  const operator = await identity(), shop = await shopWithoutBooking();
  process.env.PLATE_OPERATOR_USER_IDS = operator.userId;
  const toggle = () => toggleRoute(request("/api/operator/booking", { body: { ...shop.scope, enabled: true }, cookie: operator.cookie }));
  const fassungen = { terms: { version: OWNER_TERMS.version, stand: OWNER_TERMS.stand }, avv: { version: OWNER_AVV.version, stand: OWNER_AVV.stand } };
  expect(await status(shop.ownerCookie)).toEqual({ ...fassungen, acceptedAt: null });
  expect((await toggle()).status).toBe(409);

  const res = await accept(shop.ownerCookie);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ...fassungen, acceptedAt: expect.any(String) });
  expect(await rows(shop.scope.tenantId)).toEqual([{ user_id: shop.owner.userId, tenant_id: shop.scope.tenantId, path: "booking", terms_version: OWNER_TERMS.version,
    avv_version: OWNER_AVV.version, privacy_version: OWNER_PRIVACY_NOTICE.version, text_version: BOOKING_AVV_ACCEPTANCE_TEXT_VERSION, accepted_at: expect.any(Date) }]);
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
