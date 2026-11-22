import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { db, pool } from "@/db";
import { POST as awardRoute } from "@/app/api/cashier/award/route";
import { POST as confirmRoute } from "@/app/api/cashier/tap/[id]/confirm/route";
import { GET as pendingRoute } from "@/app/api/cashier/tap/pending/route";
import { POST as transitionRoute } from "@/app/api/merchant/booking/appointments/[id]/transition/route";
import { APPOINTMENT_ALREADY_CREDITED, awardInTransaction } from "@/lib/loyalty";
import { prepareOfflineAward, syncOfflineAward } from "@/lib/offline-earning";
import { book, completeAppointmentForAward } from "./appointments";
import { bookingShop, origin, request, withBookingDatabase } from "./test-fixture";

// ENG-201 F-1 (Reviewer, 22 Nov): one booked visit is credited once, whichever of counter, offline sync, plate tap or
// the owner's „Fertig“ comes first.
withBookingDatabase();
type Shop = Awaited<ReturnType<typeof bookingShop>>;
const quarterNow = () => new Date(Math.floor(Date.now() / 900_000) * 900_000);
const bookAt = (shop: Shop, start: Date) =>
  book({ token: shop.card.cardToken, serviceId: shop.serviceId, start, customerName: "Mia", idempotencyKey: randomUUID() }, new Date(start.getTime() - 86_400_000)).then(r => r.appointment);
const row = async (id: string) => (await pool.query("SELECT status, done_ledger_entry_id FROM booking_appointments WHERE id = $1", [id])).rows[0];
const credits = async (shop: Shop) => (await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE membership_id = $1 AND kind = 'award' AND source IN ('staff_online','staff_offline','nfc_tap')", [shop.card.id])).rows[0].n as number;
const fertig = (shop: Shop, id: string) => transitionRoute(request(`/api/merchant/booking/appointments/${id}/transition`, { body: { to: "done", expected: "confirmed" }, cookie: shop.ownerCookie }), { params: Promise.resolve({ id }) });
const counter = (shop: Shop) => awardRoute(request("/api/cashier/award", { body: { membershipId: shop.card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() }, cookie: shop.ownerCookie }));
/** A counter award whose booking completion never ran (failed, or „Fertig“ landed before it). */
const bareAward = (shop: Shop) => db.transaction(tx => awardInTransaction(tx, { userId: shop.owner.userId, locationId: shop.scope.locationId, membershipId: shop.card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() }));
/** An automatic plate credit as the tap path books it (the crypto is covered by the NFC suites). */
async function plateCredit(shop: Shop) {
  const { rows: [entry] } = await pool.query("INSERT INTO ledger_entries (tenant_id, location_id, membership_id, delta, kind, source, request_id, idempotency_key) VALUES ($1, $2, $3, 1, 'award', 'nfc_tap', gen_random_uuid(), $4) RETURNING id",
    [shop.scope.tenantId, shop.scope.locationId, shop.card.id, `tap:${randomUUID()}`]);
  await pool.query("UPDATE memberships SET balance = balance + 1 WHERE id = $1", [shop.card.id]);
  return entry.id as string;
}
async function offline(shop: Shop) {
  const deviceId = randomUUID();
  const lease = await prepareOfflineAward({ userId: shop.owner.userId, locationId: shop.scope.locationId, membershipId: shop.card.id, deviceId });
  return syncOfflineAward({ userId: shop.owner.userId, leaseId: lease.leaseId, deviceId, eventId: randomUUID(), eventAt: new Date(), award: { quantity: 1 } });
}

it("control: counter first completes the appointment; „Fertig“ afterwards is STALE; one credit", async () => {
  const shop = await bookingShop(), appointment = await bookAt(shop, quarterNow());
  expect((await counter(shop)).status).toBe(200);
  const late = await fertig(shop, appointment.id);
  expect(late.status).toBe(409);
  expect(await late.json()).toMatchObject({ code: "STALE" });
  expect(await credits(shop)).toBe(1);
});

it("an offline-synced award completes the appointment; „Fertig“ afterwards is STALE; one credit", async () => {
  const shop = await bookingShop(), appointment = await bookAt(shop, quarterNow());
  const synced = await offline(shop);
  expect(synced).toMatchObject({ status: "accepted" });
  expect(await row(appointment.id)).toEqual({ status: "done", done_ledger_entry_id: synced.entryId });
  expect((await fertig(shop, appointment.id)).status).toBe(409);
  expect(await credits(shop)).toBe(1);
});

it("a plate credit completes the appointment through the award completion; one credit", async () => {
  const shop = await bookingShop(), appointment = await bookAt(shop, quarterNow());
  const entryId = await plateCredit(shop);
  expect(await completeAppointmentForAward(entryId)).toBe(appointment.id);
  expect((await fertig(shop, appointment.id)).status).toBe(409);
  expect(await credits(shop)).toBe(1);
});

it.each([["a counter award whose completion did not run", bareAward], ["a plate credit nothing completed", plateCredit]] as const)("„Fertig“ after %s links that entry and credits nothing", async (_name, credit) => {
  const shop = await bookingShop(), appointment = await bookAt(shop, quarterNow());
  const made = await credit(shop);
  const entryId = typeof made === "string" ? made : made.entryId;
  const done = await fertig(shop, appointment.id);
  expect(done.status).toBe(200);
  expect(await done.json()).not.toHaveProperty("doneAward");
  expect(await row(appointment.id)).toEqual({ status: "done", done_ledger_entry_id: entryId });
  expect(await credits(shop)).toBe(1);
});

it("after „Fertig“, a counter award, an offline sync and a tap confirmation in the window are the same visit: refused, one credit", async () => {
  const shop = await bookingShop(), appointment = await bookAt(shop, quarterNow());
  expect((await fertig(shop, appointment.id)).status).toBe(200);
  const refused = await counter(shop);
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ code: "STALE", error: APPOINTMENT_ALREADY_CREDITED });
  expect(await offline(shop)).toEqual({ status: "rejected", reason: "STALE" });

  const { tenantId, locationId } = shop.scope;
  const { rows: [program] } = await pool.query("UPDATE programs SET tap_mode = 'staff_confirmed' WHERE tenant_id = $1 RETURNING id", [tenantId]);
  const { rows: [tag] } = await pool.query("INSERT INTO secure_tags (public_ref, tenant_id, location_id, program_id, uid, key_ref, config_version, status) VALUES ($1, $2, $3, $4, $5, 'dv1_synthetic', 1, 'active') RETURNING id",
    [randomUUID().replaceAll("-", ""), tenantId, locationId, program.id, `04${randomUUID().slice(0, 12)}`]);
  const { rows: [tap] } = await pool.query("INSERT INTO tap_requests (tag_id, counter, tenant_id, location_id, program_id, membership_id, status, expires_at) VALUES ($1, 1, $2, $3, $4, $5, 'pending_staff', now() + interval '2 minutes') RETURNING id",
    [tag.id, tenantId, locationId, program.id, shop.card.id]);
  expect(await (await pendingRoute(request("/api/cashier/tap/pending", { cookie: shop.ownerCookie }))).json()).toMatchObject([{ id: tap.id, appointment: { serviceName: "Haarschnitt", done: true } }]);
  const confirmed = await confirmRoute(new Request(`${origin}/api/cashier/tap/${tap.id}/confirm`, { method: "POST", headers: { origin, cookie: shop.ownerCookie } }), { params: Promise.resolve({ id: tap.id }) });
  expect(confirmed.status).toBe(409);
  expect(await credits(shop)).toBe(1);
});

it("outside the window a counter award is a new visit; a reversed „Fertig“ credit does not block one", async () => {
  const shop = await bookingShop(), past = await bookAt(shop, new Date(quarterNow().getTime() - 4 * 3_600_000));
  expect((await fertig(shop, past.id)).status).toBe(200);
  expect((await counter(shop)).status).toBe(200);
  expect(await credits(shop)).toBe(2);

  const other = await bookingShop(), now = await bookAt(other, quarterNow());
  expect((await fertig(other, now.id)).status).toBe(200);
  const { done_ledger_entry_id: entryId } = await row(now.id);
  await pool.query("INSERT INTO ledger_entries (tenant_id, location_id, membership_id, delta, kind, source, actor_user_id, request_id, idempotency_key, reversal_of_id, reason) VALUES ($1, $2, $3, -1, 'reversal', 'staff_correction', $4, gen_random_uuid(), $5, $6, 'Synthetic correction')",
    [other.scope.tenantId, other.scope.locationId, other.card.id, other.owner.userId, `reverse:${randomUUID()}`, entryId]);
  await pool.query("UPDATE memberships SET balance = balance - 1 WHERE id = $1", [other.card.id]);
  expect((await counter(other)).status).toBe(200);
});
