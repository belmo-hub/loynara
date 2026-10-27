import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { pool } from "@/db";
import { POST as awardRoute } from "@/app/api/cashier/award/route";
import { POST as confirmRoute } from "@/app/api/cashier/tap/[id]/confirm/route";
import { GET as pendingRoute } from "@/app/api/cashier/tap/pending/route";
import { POST as transitionRoute } from "@/app/api/merchant/booking/appointments/[id]/transition/route";
import { book } from "./appointments";
import { bookingShop, origin, request, withBookingDatabase } from "./test-fixture";

withBookingDatabase();
type Shop = Awaited<ReturnType<typeof bookingShop>>;
const quarterNow = () => new Date(Math.floor(Date.now() / 900_000) * 900_000);
const bookAt = (shop: Shop, start: Date) =>
  book({ token: shop.card.cardToken, serviceId: shop.serviceId, start, customerName: "Mia", idempotencyKey: randomUUID() }, new Date(start.getTime() - 86_400_000)).then(r => r.appointment);
const row = async (id: string) => (await pool.query("SELECT status, done_ledger_entry_id FROM booking_appointments WHERE id = $1", [id])).rows[0];
const awards = async (id: string) => (await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE membership_id = $1 AND kind = 'award'", [id])).rows[0].n as number;
const ownerDone = (shop: Shop, id: string) => transitionRoute(request(`/api/merchant/booking/appointments/${id}/transition`, { body: { to: "done", expected: "confirmed" }, cookie: shop.ownerCookie }), { params: Promise.resolve({ id }) });

/** A staff-confirmed NFC request waiting at the till, written directly: the crypto path is covered by the NFC suites. */
async function pendingTap(shop: Shop) {
  const { tenantId, locationId } = shop.scope;
  const { rows: [program] } = await pool.query("UPDATE programs SET tap_mode = 'staff_confirmed', tap_cooldown_seconds = 60 WHERE tenant_id = $1 RETURNING id", [tenantId]);
  const { rows: [tag] } = await pool.query("INSERT INTO secure_tags (public_ref, tenant_id, location_id, program_id, uid, key_ref, config_version, status) VALUES ($1, $2, $3, $4, $5, 'dv1_synthetic', 1, 'active') RETURNING id",
    [randomBytes(18).toString("base64url"), tenantId, locationId, program.id, `04${randomBytes(6).toString("hex")}`]);
  const { rows: [tap] } = await pool.query("INSERT INTO tap_requests (tag_id, counter, tenant_id, location_id, program_id, membership_id, status, expires_at) VALUES ($1, 1, $2, $3, $4, $5, 'pending_staff', now() + interval '2 minutes') RETURNING id",
    [tag.id, tenantId, locationId, program.id, shop.card.id]);
  return tap.id as string;
}

it("a counter award marks the card's appointment done with that ledger entry; the owner's later Fertig is STALE", async () => {
  const shop = await bookingShop();
  const appointment = await bookAt(shop, quarterNow());
  const response = await awardRoute(request("/api/cashier/award", { body: { membershipId: shop.card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() }, cookie: shop.ownerCookie }));
  expect(response.status).toBe(200);
  const { entryId } = await response.json();
  expect(await row(appointment.id)).toEqual({ status: "done", done_ledger_entry_id: entryId });
  const late = await ownerDone(shop, appointment.id);
  expect(late.status).toBe(409);
  expect(await late.json()).toMatchObject({ code: "STALE" });
  expect(await awards(shop.card.id)).toBe(1);
});

it("a confirmed plate tap shows the appointment in the pending list and completes it with the tap's ledger entry", async () => {
  const shop = await bookingShop();
  const appointment = await bookAt(shop, quarterNow());
  const tapId = await pendingTap(shop);
  const pending = await pendingRoute(request("/api/cashier/tap/pending", { cookie: shop.ownerCookie }));
  expect(await pending.json()).toMatchObject([{ id: tapId, appointment: { start: appointment.start, startLabel: new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(appointment.start)), serviceName: "Haarschnitt" } }]);

  // A stamp tap is confirmed without a body (and so without a content type).
  const confirmed = await confirmRoute(new Request(`${origin}/api/cashier/tap/${tapId}/confirm`, { method: "POST", headers: { origin, cookie: shop.ownerCookie } }), { params: Promise.resolve({ id: tapId }) });
  expect(confirmed.status).toBe(200);
  const { state, entryId } = await confirmed.json();
  expect(state).toBe("confirmed");
  expect(await row(appointment.id)).toEqual({ status: "done", done_ledger_entry_id: entryId });
  expect((await ownerDone(shop, appointment.id)).status).toBe(409);
  expect(await awards(shop.card.id)).toBe(1);
});

it("an award or a tap without a matching appointment changes nothing in booking", async () => {
  const shop = await bookingShop();
  const later = await bookAt(shop, new Date(quarterNow().getTime() + 3 * 3_600_000));
  const tapId = await pendingTap(shop);
  expect(await (await pendingRoute(request("/api/cashier/tap/pending", { cookie: shop.ownerCookie }))).json()).toMatchObject([{ id: tapId, appointment: null }]);
  const response = await awardRoute(request("/api/cashier/award", { body: { membershipId: shop.card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() }, cookie: shop.ownerCookie }));
  expect(response.status).toBe(200);
  expect(await row(later.id)).toEqual({ status: "confirmed", done_ledger_entry_id: null });
});
