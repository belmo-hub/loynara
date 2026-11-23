import { afterAll, expect, it } from "vitest";
import { pool } from "@/db";
import { POST as bookingRoute } from "@/app/api/operator/booking/route";
import { GET as cardBookingRoute } from "@/app/api/card/[token]/booking/route";
import { getBillingOverview } from "./billing";
import { bookingShop, identity, request, withBookingDatabase } from "./booking/test-fixture";
import { BOOKING_AVV_MISSING, operatorOverview } from "./operator";
import { BOOKING_AVV_VERSION, BOOKING_TERMS_VERSION } from "./owner-contract";
import { createMerchant } from "./product";

withBookingDatabase();
const saved = process.env.PLATE_OPERATOR_USER_IDS;
afterAll(() => { if (saved === undefined) delete process.env.PLATE_OPERATOR_USER_IDS; else process.env.PLATE_OPERATOR_USER_IDS = saved; });

const toggle = (body: unknown, cookie: string) => bookingRoute(request("/api/operator/booking", { body, cookie }));
const cardView = async (token: string) => (await cardBookingRoute(request(`/api/card/${token}/booking`), { params: Promise.resolve({ token }) })).json();
/** The shop's acceptance at sign-up of the given AVV and terms Fassungen (owner_acceptances is append-only; the row is written whole). */
const accept = (userId: string, tenantId: string, avvVersion = BOOKING_AVV_VERSION, termsVersion = BOOKING_TERMS_VERSION) => pool.query(
  "INSERT INTO owner_acceptances (user_id, tenant_id, terms_version, avv_version, privacy_version, text_version) VALUES ($1, $2, $4, $3, '2026-11-20', '2026-11-20')", [userId, tenantId, avvVersion, termsVersion]);
const settings = async (locationId: string) => (await pool.query("SELECT enabled, auto_confirm, setup_done_at FROM booking_settings WHERE location_id = $1", [locationId])).rows[0];

it("turns online booking on and off per location, leaving the owner's settings alone, and the card follows", async () => {
  const operator = await identity(), shop = await bookingShop({ autoConfirm: false });
  process.env.PLATE_OPERATOR_USER_IDS = operator.userId;
  await pool.query("UPDATE booking_settings SET enabled = false WHERE location_id = $1", [shop.scope.locationId]);
  const token = shop.card.cardToken;
  expect(await cardView(token)).toEqual({ enabled: false });
  await accept(shop.owner.userId, shop.scope.tenantId);

  const on = await toggle({ ...shop.scope, enabled: true }, operator.cookie);
  expect(on.status).toBe(200);
  expect(await on.json()).toEqual({ ...shop.scope, enabled: true });
  expect(await settings(shop.scope.locationId)).toMatchObject({ enabled: true, auto_confirm: false, setup_done_at: expect.any(Date) });
  expect(await cardView(token)).toMatchObject({ enabled: true, services: [{ name: "Haarschnitt" }] });
  expect((await operatorOverview(operator.userId)).rows).toMatchObject([{ locationId: shop.scope.locationId, bookingEnabled: true }]);
  expect((await getBillingOverview(shop.owner.userId)).locations).toMatchObject([{ locationId: shop.scope.locationId, bookingEnabled: true }]);

  expect((await toggle({ ...shop.scope, enabled: false }, operator.cookie)).status).toBe(200);
  expect(await settings(shop.scope.locationId)).toMatchObject({ enabled: false, auto_confirm: false });
  expect(await cardView(token)).toEqual({ enabled: false });
  expect((await getBillingOverview(shop.owner.userId)).locations).toMatchObject([{ bookingEnabled: false }]);
});

it("creates the settings row with defaults for a location that never ran the wizard", async () => {
  const operator = await identity(), owner = await identity();
  process.env.PLATE_OPERATOR_USER_IDS = operator.userId;
  const merchant = await createMerchant({ userId: owner.userId, businessName: "Synthetic Studio", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic programme", programType: "stamp", rulesText: "Synthetic booking rules text", rewardTitle: "Reward", rewardCost: 10 });
  expect((await operatorOverview(operator.userId)).rows).toMatchObject([{ bookingEnabled: false }]);
  await accept(owner.userId, merchant.tenantId);
  expect((await toggle({ tenantId: merchant.tenantId, locationId: merchant.locationId, enabled: true }, operator.cookie)).status).toBe(200);
  expect(await settings(merchant.locationId)).toMatchObject({ enabled: true, auto_confirm: true, setup_done_at: null });
});

it("refuses to turn booking on until the shop accepted the AVV Fassung with Terminbuchung; turning it off needs none", async () => {
  const operator = await identity(), shop = await bookingShop();
  process.env.PLATE_OPERATOR_USER_IDS = operator.userId;
  await pool.query("UPDATE booking_settings SET enabled = false WHERE location_id = $1", [shop.scope.locationId]);
  const refused = async () => { const res = await toggle({ ...shop.scope, enabled: true }, operator.cookie); expect(res.status).toBe(409); expect(await res.json()).toMatchObject({ error: BOOKING_AVV_MISSING, code: "AVV_NOT_ACCEPTED" }); };
  await refused();
  // An acceptance of the older AVV, of the right AVV with the older terms (Legal § 5), or of the right ones by another shop, does not count.
  await accept(shop.owner.userId, shop.scope.tenantId, "2026-11-20");
  await accept(shop.owner.userId, shop.scope.tenantId, BOOKING_AVV_VERSION, "2026-11-22");
  const other = await bookingShop();
  await accept(other.owner.userId, other.scope.tenantId);
  await refused();
  expect(await settings(shop.scope.locationId)).toMatchObject({ enabled: false });
  await pool.query("UPDATE booking_settings SET enabled = true WHERE location_id = $1", [shop.scope.locationId]);
  expect((await toggle({ ...shop.scope, enabled: false }, operator.cookie)).status).toBe(200);
  await accept(shop.owner.userId, shop.scope.tenantId);
  expect((await toggle({ ...shop.scope, enabled: true }, operator.cookie)).status).toBe(200);
  expect(await settings(shop.scope.locationId)).toMatchObject({ enabled: true });
});

it("refuses non-operators with an empty 404, and a location named under another tenant", async () => {
  const operator = await identity(), a = await bookingShop(), b = await bookingShop();
  process.env.PLATE_OPERATOR_USER_IDS = operator.userId;
  await pool.query("UPDATE booking_settings SET enabled = false");
  for (const cookie of ["", a.ownerCookie]) { const res = await toggle({ ...a.scope, enabled: true }, cookie); expect(res.status).toBe(404); expect(await res.text()).toBe(""); }
  expect((await toggle({ nonsense: 1 }, a.ownerCookie)).status).toBe(404);
  expect((await bookingRoute(new Request("http://localhost:3000/api/operator/booking", { method: "POST", headers: { "content-type": "application/json", cookie: operator.cookie }, body: JSON.stringify({ ...a.scope, enabled: true }) }))).status).toBe(404); // no same-origin header
  expect((await toggle({ ...a.scope, enabled: "yes" }, operator.cookie)).status).toBe(400);
  expect((await toggle({ tenantId: a.scope.tenantId, locationId: b.scope.locationId, enabled: true }, operator.cookie)).status).toBe(404);
  expect((await pool.query("SELECT count(*)::int AS n FROM booking_settings WHERE enabled")).rows[0].n).toBe(0);
});
