import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { pool } from "@/db";
import { GET as lookupRoute, POST as bookRoute } from "@/app/api/merchant/booking/caller/route";
import { GET as slotsRoute } from "@/app/api/merchant/booking/caller/slots/route";
import { GET as nextFreeRoute } from "@/app/api/merchant/booking/caller/next-free/route";
import { formatCardLocator } from "@/lib/card-locator";
import { enroll } from "@/lib/product";
import { CALLER_CARD_MISSING } from "./appointments";
import { allWeek, bookingShop, dayOf, futureStart, identity, request, withBookingDatabase } from "./test-fixture";
import { addDays, instantToWall } from "./time";

// ENG-372 (founder Q-116 c): the shop enters a caller's appointment, only for an existing card found by its number.
withBookingDatabase();

type Shop = Awaited<ReturnType<typeof bookingShop>>;
const locator = async (shop: Shop) => formatCardLocator((await pool.query("SELECT card_locator FROM memberships WHERE id = $1", [shop.card.id])).rows[0].card_locator);
const bookFor = (shop: Shop, card: string, extra: Partial<{ start: string; customerName: string; idempotencyKey: string; staffId: string }> = {}, cookie = shop.ownerCookie) =>
  bookRoute(request("/api/merchant/booking/caller", { cookie, body: { card, serviceId: shop.serviceId, staffId: extra.staffId ?? shop.staffId, start: extra.start ?? futureStart().toISOString(), customerName: extra.customerName ?? "Mia", idempotencyKey: extra.idempotencyKey ?? randomUUID() } }));
const rows = async (shop: Shop) => (await pool.query("SELECT status, customer_name, customer_phone, membership_id FROM booking_appointments WHERE tenant_id = $1", [shop.scope.tenantId])).rows;

it("books a confirmed appointment for the card by its number, without a phone, and a retry with the same key adds nothing", async () => {
  const shop = await bookingShop({ autoConfirm: false });
  const number = await locator(shop);
  const key = randomUUID();
  const res = await bookFor(shop, number.toLowerCase().replace("-", ""), { idempotencyKey: key });
  expect(res.status).toBe(201);
  const created = await res.json();
  expect(created).toMatchObject({ status: "confirmed", customerName: "Mia", customerPhone: null, cardLocator: number, staff: { id: shop.staffId } });
  const again = await bookFor(shop, number, { idempotencyKey: key });
  expect(again.status).toBe(200);
  expect((await again.json()).id).toBe(created.id);
  expect(await rows(shop)).toEqual([{ status: "confirmed", customer_name: "Mia", customer_phone: null, membership_id: shop.card.id }]);
});

it("refuses a number that is no open card of this location: unknown, another shop's, or closed, and writes nothing", async () => {
  const shop = await bookingShop(), other = await bookingShop();
  const closed = await bookingShop();
  const closedNumber = await locator(closed);
  await pool.query("UPDATE memberships SET closed_at = now() WHERE id = $1", [closed.card.id]);
  for (const [target, card] of [[shop, "K-ZZZZZZ"], [shop, "Mia Muster"], [shop, await locator(other)], [closed, closedNumber]] as const) {
    const res = await bookFor(target, card);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: CALLER_CARD_MISSING });
    const lookup = await lookupRoute(request(`/api/merchant/booking/caller?card=${encodeURIComponent(card)}`, { cookie: target.ownerCookie }));
    expect(lookup.status).toBe(404);
  }
  for (const target of [shop, closed]) expect(await rows(target)).toEqual([]);
});

it("a manager may enter one, a cashier may not; the slot must be free; a card paused online can still be booked by the shop", async () => {
  const shop = await bookingShop();
  const number = await locator(shop);
  const cashier = await identity(), manager = await identity();
  await pool.query("INSERT INTO staff_roles (tenant_id, user_id, role, location_id) VALUES ($1, $2, 'cashier', $4), ($1, $3, 'manager', $4)", [shop.scope.tenantId, cashier.userId, manager.userId, shop.scope.locationId]);
  expect((await bookFor(shop, number, {}, cashier.cookie)).status).toBe(403);
  await pool.query("INSERT INTO booking_blocked_customers (tenant_id, membership_id, reason) VALUES ($1, $2, 'Nicht erschienen')", [shop.scope.tenantId, shop.card.id]);
  expect((await bookFor(shop, number, { customerName: "Ali" }, manager.cookie)).status).toBe(201);
  const taken = await bookFor(shop, number);
  expect(taken.status).toBe(409);
  expect(await taken.json()).toMatchObject({ code: expect.stringMatching(/SLOT_TAKEN|OWN_OVERLAP/) });
  expect(await rows(shop)).toHaveLength(1);
});

it("the lookup offers the name from the card's last booking here, and the slots list who is free for the service", async () => {
  const shop = await bookingShop();
  const number = await locator(shop);
  const lookup = async () => (await lookupRoute(request(`/api/merchant/booking/caller?card=${number}`, { cookie: shop.ownerCookie }))).json();
  expect(await lookup()).toEqual({ cardLocator: number, name: null });
  const start = futureStart();
  await bookFor(shop, number, { customerName: "Jonas", start: start.toISOString() });
  expect(await lookup()).toEqual({ cardLocator: number, name: "Jonas" });
  const slots = await (await slotsRoute(request(`/api/merchant/booking/caller/slots?serviceId=${shop.serviceId}&date=${dayOf(start)}`, { cookie: shop.ownerCookie }))).json();
  expect(slots.staff).toEqual([{ id: shop.staffId, name: "Lena" }]);
  expect(slots.slots.length).toBeGreaterThan(0);
  expect(slots.slots.map((s: { start: string }) => s.start)).not.toContain(start.toISOString());
});

it("refuses while online booking is off at the location", async () => {
  const shop = await bookingShop();
  await pool.query("UPDATE booking_settings SET enabled = false WHERE location_id = $1", [shop.scope.locationId]);
  expect((await bookFor(shop, await locator(shop))).status).toBe(404);
  expect(await rows(shop)).toEqual([]);
});

it("„Nächster freier Tag“ is one request: the first of the next 28 days with a free start, for the chosen person", async () => {
  // Lena works one weekday only: the one three days from today in Berlin.
  const today = instantToWall(new Date(), "Europe/Berlin").date;
  const target = addDays(today, 3);
  const weekday = ((new Date(`${target}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const shop = await bookingShop({ workingHours: allWeek().filter(day => day.weekday === weekday) });
  const nextFree = async (query: string) => nextFreeRoute(request(`/api/merchant/booking/caller/next-free?serviceId=${shop.serviceId}&${query}`, { cookie: shop.ownerCookie }));
  expect(await (await nextFree(`from=${addDays(today, 1)}`)).json()).toEqual({ date: target });
  expect(await (await nextFree(`from=${target}&staffId=${shop.staffId}`)).json()).toEqual({ date: target });
  expect(await (await nextFree(`from=${addDays(target, 1)}`)).json()).toEqual({ date: addDays(target, 7) });
  expect((await nextFree(`from=${today}&staffId=00000000-0000-4000-8000-000000000000`)).status).toBe(404);
});

// Reviewer's proofs (26 Nov, N-1): each pins a break the tests above let through.
const locatorOf = async (membershipId: string) => formatCardLocator((await pool.query("SELECT card_locator FROM memberships WHERE id = $1", [membershipId])).rows[0].card_locator);
const lookupOf = async (shop: Shop, card: string) => (await lookupRoute(request(`/api/merchant/booking/caller?card=${encodeURIComponent(card)}`, { cookie: shop.ownerCookie }))).json();
const later = (hours: number) => new Date(futureStart().getTime() + hours * 3_600_000).toISOString();
/** A copy of the card's programme with its own id and slug, at `locationId` and with `status`, and the card moved into it; the shop's own programme stays active. */
async function moveCard(shop: Shop, changes: { locationId?: string; status: string }) {
  const [{ id }] = (await pool.query(`INSERT INTO programs SELECT (jsonb_populate_record(NULL::programs, to_jsonb(p) || jsonb_build_object('id', gen_random_uuid(), 'slug', p.slug || '-zz', 'location_id', coalesce($2::uuid, p.location_id), 'status', $3::text))).* FROM programs p WHERE p.id = (SELECT program_id FROM memberships WHERE id = $1) RETURNING id`, [shop.card.id, changes.locationId ?? null, changes.status])).rows;
  await pool.query("UPDATE memberships SET program_id = $2 WHERE id = $1", [shop.card.id, id]);
}

it("P1 a card of another location of the same shop is refused here", async () => {
  const shop = await bookingShop();
  const number = await locatorOf(shop.card.id);
  const [{ id }] = (await pool.query(`INSERT INTO locations SELECT (jsonb_populate_record(NULL::locations, to_jsonb(l) || jsonb_build_object('id', gen_random_uuid(), 'name', 'Zweiter Standort'))).* FROM locations l WHERE l.id = $1 RETURNING id`, [shop.scope.locationId])).rows;
  await moveCard(shop, { locationId: id, status: "active" });
  expect((await bookFor(shop, number)).status).toBe(404);
});

it("P2 a card of an ended programme at this location is refused", async () => {
  const shop = await bookingShop();
  const number = await locatorOf(shop.card.id);
  await moveCard(shop, { status: "ended" });
  expect((await bookFor(shop, number)).status).toBe(404);
});

it("P3 the lookup never offers a cleared name, nor another card's name", async () => {
  const shop = await bookingShop();
  const first = await locatorOf(shop.card.id);
  expect((await bookFor(shop, first, { customerName: "Jonas" })).status).toBe(201);
  await pool.query("UPDATE booking_appointments SET customer_name = 'Name gelöscht' WHERE membership_id = $1", [shop.card.id]);
  expect(await lookupOf(shop, first)).toEqual({ cardLocator: first, name: null });
  const second = await enroll({ slug: shop.merchant.programSlug, acceptedTerms: true });
  const secondNumber = await locatorOf(second.id);
  expect((await bookFor(shop, secondNumber, { customerName: "Ali", start: later(2) })).status).toBe(201);
  expect(await lookupOf(shop, first)).toEqual({ cardLocator: first, name: null });
});

it("P4 a key reused for another card is refused and books nothing for it", async () => {
  const shop = await bookingShop();
  const key = randomUUID();
  expect((await bookFor(shop, await locatorOf(shop.card.id), { idempotencyKey: key })).status).toBe(201);
  const second = await enroll({ slug: shop.merchant.programSlug, acceptedTerms: true });
  const res = await bookFor(shop, await locatorOf(second.id), { idempotencyKey: key, start: later(2) });
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ code: "KEY_REUSED" });
  expect((await pool.query("SELECT count(*)::int AS n FROM booking_appointments WHERE membership_id = $1", [second.id])).rows[0].n).toBe(0);
});

it("P5 an entered appointment gets its reminders like an online one", async () => {
  const shop = await bookingShop();
  const created = await (await bookFor(shop, await locatorOf(shop.card.id))).json() as { id: string };
  expect((await pool.query("SELECT count(*)::int AS n FROM outbox_jobs WHERE kind = 'booking.reminder' AND payload->>'appointmentId' = $1", [created.id])).rows[0].n).toBeGreaterThan(0);
});
