import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { bookingAppointments, bookingBlockedCustomers, bookingBlocks, bookingServices, bookingSettings, bookingStaff, bookingStaffServices, ledgerEntries, locations, memberships, programRuleVersions, programs, tenants } from "@/db/schema";
import { validCardToken } from "@/lib/card-lifecycle";
import { formatCardLocator } from "@/lib/card-locator";
import { requireSameOrigin, sessionUser } from "@/lib/http";
import { selectedLocationFromRequest } from "@/lib/locations";
import { awardInTransaction, DomainError } from "@/lib/loyalty";
import { getMerchantContext } from "@/lib/product";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { GRID_MIN, slots } from "./availability";
import { notifyShopChange, pushState, scheduleReminders } from "./notify";
import { getSetup } from "./setup";
import { addDays, instantToWall, wallToInstant } from "./time";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Reader = typeof db | Tx;
type Settings = typeof bookingSettings.$inferSelect;
type Scope = { tenantId: string; locationId: string };
type Status = "requested" | "confirmed" | "done" | "no_show" | "cancelled_by_customer" | "cancelled_by_shop";

/** A DomainError whose details go into the response body (nextFree, staffId and count). */
export class BookingError extends DomainError {
  constructor(code: string, message: string, public details: Record<string, unknown>) { super(code, message); }
}

const OPEN: Status[] = ["requested", "confirmed"];
const MINUTE = 60_000, HOUR = 3_600_000;

/** Serialises every booking write of one location; the EXCLUDE constraints stay the backstop. */
export const lockLocation = (tx: Tx, locationId: string) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"booking:" + locationId}, 0))`);

const range = (start: Date, end: Date) => sql`tstzrange(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, '[)')`;
const lower = (column: typeof bookingAppointments.during | typeof bookingBlocks.during) => sql<Date>`lower(${column})`.mapWith(value => new Date(value));
const upper = (column: typeof bookingAppointments.during | typeof bookingBlocks.during) => sql<Date>`upper(${column})`.mapWith(value => new Date(value));
const isOpen = (status: string) => (OPEN as string[]).includes(status);

function databaseCode(error: unknown) {
  const cause = error instanceof Error && error.cause ? error.cause : error;
  return cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
}

// ---- Rules (pure) -----------------------------------------------------------------------------------------------------

const TRANSITIONS: Record<string, Status[]> = { requested: ["confirmed", "done", "no_show", "cancelled_by_shop"], confirmed: ["done", "no_show", "cancelled_by_shop"] };

/** Owner transitions: `expected` must still be the status, done and no-show only from 10 minutes before the start. */
export function assertTransition(current: string, expected: string, to: string, start: Date, now: Date) {
  if (current !== expected) throw new DomainError("STALE", "The appointment has changed; reload");
  if (!TRANSITIONS[current]?.includes(to as Status)) throw new DomainError("INVALID_TRANSITION", "Transition not allowed");
  if ((to === "done" || to === "no_show") && start.getTime() > now.getTime() + 10 * MINUTE) throw new DomainError("TOO_EARLY", "The appointment has not started yet");
}

export const isLateCancel = (start: Date, deadlineHours: number, now: Date) => now.getTime() >= start.getTime() - deadlineHours * HOUR;
export const rescheduleAllowed = (countThisMonth: number, max: number) => countThisMonth < max;
export const blocksAfterNoShow = (noShowsIn12Months: number, threshold: number) => threshold > 0 && noShowsIn12Months >= threshold;

/** On the 15-minute wall-clock grid, not before now + lead time, not after today + max days. */
export function assertInWindow(start: Date, settings: Pick<Settings, "leadTimeMin" | "maxDaysAhead">, now: Date, timeZone: string) {
  const wall = instantToWall(start, timeZone);
  if (Number(wall.time.slice(3)) % GRID_MIN !== 0 || wall.second !== 0 || start.getUTCMilliseconds() !== 0
    || start.getTime() < now.getTime() + settings.leadTimeMin * MINUTE || wall.date > addDays(instantToWall(now, timeZone).date, settings.maxDaysAhead)) {
    throw new DomainError("OUT_OF_WINDOW", "This time cannot be booked");
  }
}

// ---- Reads --------------------------------------------------------------------------------------------------------------

export async function cardScope(reader: Reader, token: string) {
  if (!validCardToken(token)) throw new DomainError("NOT_FOUND", "Card not found");
  const [card] = await reader.select({ tenantId: memberships.tenantId, membershipId: memberships.id, locationId: programs.locationId, timezone: locations.timezone, shopName: tenants.name })
    .from(memberships)
    .innerJoin(programs, and(eq(programs.id, memberships.programId), eq(programs.tenantId, memberships.tenantId)))
    .innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.cardToken, token), isNull(memberships.closedAt), eq(programs.status, "active")));
  if (!card) throw new DomainError("NOT_FOUND", "Card not found");
  return card;
}

async function settingsOf(reader: Reader, scope: Scope, enabledOnly = true) {
  const [settings] = await reader.select().from(bookingSettings).where(and(eq(bookingSettings.tenantId, scope.tenantId), eq(bookingSettings.locationId, scope.locationId)));
  if (!settings || (enabledOnly && !settings.enabled)) throw new DomainError("NOT_FOUND", "Online booking is not available here");
  return settings;
}

async function timezoneOf(reader: Reader, scope: Scope) {
  const [location] = await reader.select({ timezone: locations.timezone }).from(locations).where(and(eq(locations.tenantId, scope.tenantId), eq(locations.id, scope.locationId)));
  if (!location) throw new DomainError("NOT_FOUND", "Location not found");
  return location.timezone;
}

async function liveService(reader: Reader, scope: Scope, serviceId: string) {
  const [service] = await reader.select().from(bookingServices)
    .where(and(eq(bookingServices.tenantId, scope.tenantId), eq(bookingServices.locationId, scope.locationId), eq(bookingServices.id, serviceId), isNull(bookingServices.archivedAt)));
  if (!service) throw new DomainError("NOT_FOUND", "Service not found");
  return service;
}

type SlotService = { id: string; durationMin: number; bufferMin: number };

/** Free slots for whole days, read from the location's live staff, blocks and open appointments (minus `excludeId`). */
async function availability(reader: Reader, scope: Scope & { timezone: string }, input: { service: SlotService; staffId?: string; days: string[]; excludeId?: string; settings: Pick<Settings, "leadTimeMin" | "maxDaysAhead">; now: Date }) {
  const staffRows = await reader.select({ id: bookingStaff.id, sort: bookingStaff.sort, workingHours: bookingStaff.workingHours }).from(bookingStaff)
    .where(and(eq(bookingStaff.tenantId, scope.tenantId), eq(bookingStaff.locationId, scope.locationId), isNull(bookingStaff.archivedAt), input.staffId ? eq(bookingStaff.id, input.staffId) : undefined));
  if (input.staffId && !staffRows.length) throw new DomainError("NOT_FOUND", "Staff member not found");
  const links = staffRows.length ? await reader.select().from(bookingStaffServices).where(and(eq(bookingStaffServices.tenantId, scope.tenantId), inArray(bookingStaffServices.staffId, staffRows.map(s => s.id)))) : [];
  // A day either side covers every timezone's local midnight.
  const window = range(new Date(Date.parse(`${input.days[0]}T00:00:00Z`) - 86_400_000), new Date(`${addDays(input.days[input.days.length - 1], 2)}T00:00:00Z`));
  const blocks = await reader.select({ staffId: bookingBlocks.staffId, start: lower(bookingBlocks.during), end: upper(bookingBlocks.during) }).from(bookingBlocks)
    .where(and(eq(bookingBlocks.tenantId, scope.tenantId), eq(bookingBlocks.locationId, scope.locationId), sql`${bookingBlocks.during} && ${window}`));
  const appointments = await reader.select({ staffId: bookingAppointments.staffId, start: lower(bookingAppointments.during), end: upper(bookingAppointments.during) }).from(bookingAppointments)
    .where(and(eq(bookingAppointments.tenantId, scope.tenantId), eq(bookingAppointments.locationId, scope.locationId), inArray(bookingAppointments.status, OPEN),
      sql`${bookingAppointments.during} && ${window}`, input.excludeId ? ne(bookingAppointments.id, input.excludeId) : undefined));
  return slots({
    days: input.days, service: input.service, blocks, appointments, settings: input.settings, now: input.now, tz: scope.timezone,
    staff: staffRows.map(s => ({ ...s, serviceIds: links.filter(l => l.staffId === s.id).map(l => l.serviceId) })),
  });
}

/** The slot at `start`, or BLOCKED / SLOT_TAKEN (with the next free start that day). */
async function findSlot(tx: Tx, scope: Scope & { timezone: string }, input: { service: SlotService; staffId?: string; start: Date; excludeId?: string; settings: Pick<Settings, "leadTimeMin" | "maxDaysAhead">; now: Date }) {
  const [day] = await availability(tx, scope, { ...input, days: [instantToWall(input.start, scope.timezone).date] });
  const nextFree = day.slots.find(s => s.start > input.start)?.start.toISOString();
  const slot = day.slots.find(s => s.start.getTime() === input.start.getTime());
  if (slot) return { slot, nextFree };
  const end = new Date(input.start.getTime() + (input.service.durationMin + input.service.bufferMin) * MINUTE);
  const [block] = await tx.select({ id: bookingBlocks.id }).from(bookingBlocks).where(and(eq(bookingBlocks.tenantId, scope.tenantId), eq(bookingBlocks.locationId, scope.locationId),
    sql`${bookingBlocks.during} && ${range(input.start, end)}`, input.staffId ? or(isNull(bookingBlocks.staffId), eq(bookingBlocks.staffId, input.staffId)) : isNull(bookingBlocks.staffId))).limit(1);
  if (block) throw new DomainError("BLOCKED", "The shop is closed at this time");
  throw new BookingError("SLOT_TAKEN", "This time was just taken", { nextFree });
}

const slotTaken = (nextFree?: string) => (error: unknown): never => {
  if (databaseCode(error) === "23P01") throw new BookingError("SLOT_TAKEN", "This time was just taken", { nextFree });
  throw error;
};

const noShowCount = sql<number>`(SELECT count(*)::int FROM booking_appointments n WHERE n.tenant_id = ${bookingAppointments.tenantId} AND n.membership_id = ${bookingAppointments.membershipId}
  AND n.status = 'no_show' AND lower(n.during) > now() - interval '12 months')`;

async function appointmentRows(reader: Reader, where: SQL | undefined, order: SQL = asc(sql`lower(${bookingAppointments.during})`), limit = 500) {
  return reader.select({
    a: bookingAppointments, start: lower(bookingAppointments.during), end: upper(bookingAppointments.during), serviceName: bookingServices.name, staffName: bookingStaff.name,
    cardLocator: memberships.cardLocator, noShowCount, deadlineHours: bookingSettings.cancelDeadlineHours,
  }).from(bookingAppointments)
    .innerJoin(bookingServices, and(eq(bookingServices.tenantId, bookingAppointments.tenantId), eq(bookingServices.id, bookingAppointments.serviceId)))
    .innerJoin(bookingStaff, and(eq(bookingStaff.tenantId, bookingAppointments.tenantId), eq(bookingStaff.id, bookingAppointments.staffId)))
    .innerJoin(memberships, and(eq(memberships.tenantId, bookingAppointments.tenantId), eq(memberships.id, bookingAppointments.membershipId)))
    .innerJoin(bookingSettings, and(eq(bookingSettings.tenantId, bookingAppointments.tenantId), eq(bookingSettings.locationId, bookingAppointments.locationId)))
    .where(where).orderBy(order).limit(limit);
}
type Row = Awaited<ReturnType<typeof appointmentRows>>[number];
// The booked length (duration + buffer) stays as booked; later service edits never change it.
const bookedService = (row: Row): SlotService => ({ id: row.a.serviceId, durationMin: row.a.durationMin, bufferMin: (row.end.getTime() - row.start.getTime()) / MINUTE - row.a.durationMin });

function customerView(row: Row, now: Date) {
  const { a, start } = row, deadline = new Date(start.getTime() - row.deadlineHours * HOUR), open = isOpen(a.status);
  return {
    id: a.id, status: a.status, start: start.toISOString(), durationMin: a.durationMin, priceMinor: a.priceMinor,
    service: { id: a.serviceId, name: row.serviceName }, staff: { id: a.staffId, name: row.staffName },
    rescheduleCount: a.rescheduleCount, lateCancel: a.lateCancel, canCancel: open && start > now, canReschedule: open && now < deadline, cancelDeadline: deadline.toISOString(),
  };
}

function ownerView(row: Row, now: Date) {
  return { ...customerView(row, now), customerName: row.a.customerName, customerPhone: row.a.customerPhone, cardLocator: formatCardLocator(row.cardLocator), membershipId: row.a.membershipId, noShowCount: row.noShowCount };
}

async function one(reader: Reader, tenantId: string, id: string) {
  const [row] = await appointmentRows(reader, and(eq(bookingAppointments.tenantId, tenantId), eq(bookingAppointments.id, id)));
  return row;
}

// ---- Customer (card token) --------------------------------------------------------------------------------------------

export async function cardView(token: string, now = new Date()) {
  const card = await cardScope(db, token);
  const [settings] = await db.select().from(bookingSettings).where(and(eq(bookingSettings.tenantId, card.tenantId), eq(bookingSettings.locationId, card.locationId)));
  if (!settings?.enabled) return { enabled: false };
  const [blocked] = await db.select({ id: bookingBlockedCustomers.membershipId }).from(bookingBlockedCustomers).where(and(eq(bookingBlockedCustomers.tenantId, card.tenantId), eq(bookingBlockedCustomers.membershipId, card.membershipId)));
  const setup = await getSetup(card);
  const mine = and(eq(bookingAppointments.tenantId, card.tenantId), eq(bookingAppointments.membershipId, card.membershipId));
  const upcoming = sql`${bookingAppointments.status} in ('requested','confirmed') and upper(${bookingAppointments.during}) > ${now.toISOString()}::timestamptz`;
  return {
    enabled: true, blocked: Boolean(blocked),
    shop: { name: card.shopName, timezone: card.timezone, termsText: settings.termsText, cancelDeadlineHours: settings.cancelDeadlineHours, maxReschedulesPerMonth: settings.maxReschedulesPerMonth, autoConfirm: settings.autoConfirm,
      noShowBlockAfter: settings.noShowBlockAfter, maxOpenPerCard: settings.maxOpenPerCard },
    services: setup.services.map(s => ({ id: s.id, name: s.name, durationMin: s.durationMin, priceMinor: s.priceMinor, priceFrom: s.priceFrom })),
    staff: setup.staff.map(s => ({ id: s.id, name: s.name, serviceIds: s.serviceIds })),
    upcoming: (await appointmentRows(db, and(mine, upcoming))).map(row => customerView(row, now)),
    past: (await appointmentRows(db, and(mine, sql`not (${upcoming})`), desc(sql`lower(${bookingAppointments.during})`), 5)).map(row => customerView(row, now)),
    push: await pushState(db, card),
  };
}

export async function customerSlots(token: string, input: { serviceId: string; staffId?: string; from: string; days: number }, now = new Date()) {
  const card = await cardScope(db, token);
  const settings = await settingsOf(db, card);
  const service = await liveService(db, card, input.serviceId);
  const days = Array.from({ length: input.days }, (_, i) => addDays(input.from, i));
  return { days: (await availability(db, card, { service, staffId: input.staffId, days, settings, now })).map(d => ({ date: d.date, slots: d.slots.map(s => ({ start: s.start.toISOString(), staffId: s.staffId })) })) };
}

export type BookInput = { token: string; serviceId: string; staffId?: string; start: Date; customerName: string; customerPhone?: string; idempotencyKey: string; rebookSourceId?: string };

export async function book(input: BookInput, now = new Date()) {
  return db.transaction(async tx => {
    const card = await cardScope(tx, input.token);
    await lockLocation(tx, card.locationId);
    const [existing] = await tx.select({ id: bookingAppointments.id, membershipId: bookingAppointments.membershipId }).from(bookingAppointments)
      .where(and(eq(bookingAppointments.tenantId, card.tenantId), eq(bookingAppointments.idempotencyKey, input.idempotencyKey)));
    if (existing) {
      if (existing.membershipId !== card.membershipId) throw new DomainError("KEY_REUSED", "Idempotency key was used for another operation");
      return { appointment: customerView(await one(tx, card.tenantId, existing.id), now), duplicate: true };
    }
    const settings = await settingsOf(tx, card);
    const [blocked] = await tx.select({ id: bookingBlockedCustomers.membershipId }).from(bookingBlockedCustomers).where(and(eq(bookingBlockedCustomers.tenantId, card.tenantId), eq(bookingBlockedCustomers.membershipId, card.membershipId)));
    if (blocked) throw new DomainError("BLOCKED_CUSTOMER", "Online booking is paused for this card; please call the shop");
    const [open] = await tx.select({ count: sql<number>`count(*)::int` }).from(bookingAppointments).where(and(eq(bookingAppointments.tenantId, card.tenantId), eq(bookingAppointments.membershipId, card.membershipId),
      inArray(bookingAppointments.status, OPEN), sql`upper(${bookingAppointments.during}) > ${now.toISOString()}::timestamptz`));
    if (open.count >= settings.maxOpenPerCard) throw new DomainError("TOO_MANY_OPEN", "Too many open appointments on this card");
    assertInWindow(input.start, settings, now, card.timezone);
    const service = await liveService(tx, card, input.serviceId);
    const { slot, nextFree } = await findSlot(tx, card, { service, staffId: input.staffId, start: input.start, settings, now });
    const [row] = await tx.insert(bookingAppointments).values({
      tenantId: card.tenantId, locationId: card.locationId, membershipId: card.membershipId, serviceId: service.id, staffId: slot.staffId,
      during: range(input.start, new Date(input.start.getTime() + (service.durationMin + service.bufferMin) * MINUTE)), durationMin: service.durationMin, priceMinor: service.priceMinor,
      status: settings.autoConfirm ? "confirmed" : "requested", customerName: input.customerName, customerPhone: input.customerPhone, idempotencyKey: input.idempotencyKey,
      // Only this card's own appointment counts as the source, so a crafted link cannot inflate „über Erinnerung neu gebucht“.
      rebookSourceId: input.rebookSourceId ? sql`(SELECT r.id FROM booking_appointments r WHERE r.tenant_id = ${card.tenantId}::uuid AND r.membership_id = ${card.membershipId}::uuid AND r.id = ${input.rebookSourceId}::uuid)` : null,
    }).returning({ id: bookingAppointments.id }).catch(slotTaken(nextFree));
    await scheduleReminders(tx, row.id, now);
    return { appointment: customerView(await one(tx, card.tenantId, row.id), now), duplicate: false };
  });
}

async function customerAppointment(tx: Tx, card: Awaited<ReturnType<typeof cardScope>>, appointmentId: string) {
  const [row] = await appointmentRows(tx, and(eq(bookingAppointments.tenantId, card.tenantId), eq(bookingAppointments.membershipId, card.membershipId), eq(bookingAppointments.id, appointmentId)));
  if (!row) throw new DomainError("NOT_FOUND", "Appointment not found");
  return row;
}

/** Keeps the status; a retry that already landed on `start` returns the appointment unchanged. */
export async function reschedule(input: { token: string; appointmentId: string; start: Date; staffId?: string }, now = new Date()) {
  return db.transaction(async tx => {
    const card = await cardScope(tx, input.token);
    await lockLocation(tx, card.locationId);
    const settings = await settingsOf(tx, card);
    const row = await customerAppointment(tx, card, input.appointmentId);
    if (!isOpen(row.a.status)) throw new DomainError("STALE", "The appointment has changed; reload");
    // A paused card keeps its appointment but cannot move it: the same gate as book().
    const [blocked] = await tx.select({ id: bookingBlockedCustomers.membershipId }).from(bookingBlockedCustomers).where(and(eq(bookingBlockedCustomers.tenantId, card.tenantId), eq(bookingBlockedCustomers.membershipId, card.membershipId)));
    if (blocked) throw new DomainError("BLOCKED_CUSTOMER", "Online booking is paused for this card; please call the shop");
    if (row.start.getTime() === input.start.getTime() && (!input.staffId || input.staffId === row.a.staffId)) return customerView(row, now);
    if (isLateCancel(row.start, settings.cancelDeadlineHours, now)) throw new DomainError("TOO_LATE", "Too late to reschedule online");
    // shortcut: counts reschedules of this card's appointments last changed this month (Berlin); a reschedule log would be exact.
    const [month] = await tx.select({ count: sql<number>`coalesce(sum(${bookingAppointments.rescheduleCount}), 0)::int` }).from(bookingAppointments)
      .where(and(eq(bookingAppointments.tenantId, card.tenantId), eq(bookingAppointments.membershipId, card.membershipId),
        sql`to_char(${bookingAppointments.updatedAt} AT TIME ZONE ${card.timezone}, 'YYYY-MM') = ${instantToWall(now, card.timezone).date.slice(0, 7)}`));
    if (!rescheduleAllowed(month.count, settings.maxReschedulesPerMonth)) throw new DomainError("RESCHEDULE_LIMIT", "Reschedule limit reached this month");
    assertInWindow(input.start, settings, now, card.timezone);
    const service = bookedService(row);
    const { slot, nextFree } = await findSlot(tx, card, { service, staffId: input.staffId, start: input.start, excludeId: row.a.id, settings, now });
    await moveRow(tx, row, slot.staffId, input.start, service, { rescheduleCount: row.a.rescheduleCount + 1, updatedAt: now }).catch(slotTaken(nextFree));
    await scheduleReminders(tx, row.a.id, now);
    return customerView(await one(tx, card.tenantId, row.a.id), now);
  });
}

async function moveRow(tx: Tx, row: Row, staffId: string, start: Date, service: SlotService, extra: { rescheduleCount?: number; updatedAt?: Date } = {}) {
  const moved = await tx.update(bookingAppointments).set({ staffId, during: range(start, new Date(start.getTime() + (service.durationMin + service.bufferMin) * MINUTE)), updatedAt: new Date(), ...extra })
    .where(and(eq(bookingAppointments.tenantId, row.a.tenantId), eq(bookingAppointments.id, row.a.id), eq(bookingAppointments.status, row.a.status))).returning({ id: bookingAppointments.id });
  if (!moved.length) throw new DomainError("STALE", "The appointment has changed; reload");
}

/** Always allowed while open; inside the deadline it is flagged as a late cancellation. */
export async function cancelByCustomer(input: { token: string; appointmentId: string }, now = new Date()) {
  return db.transaction(async tx => {
    const card = await cardScope(tx, input.token);
    await lockLocation(tx, card.locationId);
    const row = await customerAppointment(tx, card, input.appointmentId);
    if (row.a.status === "cancelled_by_customer") return customerView(row, now);
    if (!isOpen(row.a.status)) throw new DomainError("STALE", "The appointment has changed; reload");
    await setStatus(tx, row, "cancelled_by_customer", { cancelledAt: now, lateCancel: isLateCancel(row.start, row.deadlineHours, now) });
    return customerView(await one(tx, card.tenantId, row.a.id), now);
  });
}

async function setStatus(tx: Tx, row: Row, to: Status, extra: Partial<typeof bookingAppointments.$inferInsert> = {}) {
  const updated = await tx.update(bookingAppointments).set({ status: to, updatedAt: new Date(), ...extra })
    .where(and(eq(bookingAppointments.tenantId, row.a.tenantId), eq(bookingAppointments.id, row.a.id), eq(bookingAppointments.status, row.a.status))).returning({ id: bookingAppointments.id });
  if (!updated.length) throw new DomainError("STALE", "The appointment has changed; reload");
}

// ---- Owner and manager (tenant + selected location) --------------------------------------------------------------------

async function ownerAppointment(tx: Tx, scope: Scope, appointmentId: string) {
  const [row] = await appointmentRows(tx, and(eq(bookingAppointments.tenantId, scope.tenantId), eq(bookingAppointments.locationId, scope.locationId), eq(bookingAppointments.id, appointmentId)));
  if (!row) throw new DomainError("NOT_FOUND", "Appointment not found");
  return row;
}

export type TransitionInput = Scope & { userId: string; appointmentId: string; to: Status; expected: Status; purchaseAmountMinor?: number; reason?: string };

/** "Fertig" awards once, in the same transaction, keyed "booking:" + id; every transition is UPDATE … WHERE status = expected. */
export async function transition(input: TransitionInput, now = new Date()) {
  return db.transaction(async tx => {
    await lockLocation(tx, input.locationId);
    const first = await ownerAppointment(tx, input, input.appointmentId);
    // Card before appointment, the order an award (and the tap path's completeAppointmentForAward) takes them in.
    await tx.execute(sql`SELECT 1 FROM memberships WHERE tenant_id = ${input.tenantId}::uuid AND id = ${first.a.membershipId}::uuid FOR UPDATE`);
    await tx.execute(sql`SELECT 1 FROM booking_appointments WHERE tenant_id = ${input.tenantId}::uuid AND id = ${first.a.id}::uuid FOR UPDATE`);
    const row = await ownerAppointment(tx, input, input.appointmentId);
    assertTransition(row.a.status, input.expected, input.to, row.start, now);
    let doneAward: { balance: number; creditedQuantity: number } | undefined;
    if (input.to === "done") {
      const [program] = await tx.select({ id: programs.id, type: programs.type, earningMode: programs.earningMode }).from(memberships)
        .innerJoin(programs, and(eq(programs.id, memberships.programId), eq(programs.tenantId, memberships.tenantId)))
        .where(and(eq(memberships.tenantId, input.tenantId), eq(memberships.id, row.a.membershipId)));
      const [rule] = program.type === "points" && program.earningMode === "purchase"
        ? await tx.select({ id: programRuleVersions.id }).from(programRuleVersions).where(and(eq(programRuleVersions.tenantId, input.tenantId), eq(programRuleVersions.programId, program.id))).orderBy(desc(programRuleVersions.version)).limit(1)
        : [];
      const award = await awardInTransaction(tx, {
        userId: input.userId, locationId: input.locationId, membershipId: row.a.membershipId, idempotencyKey: `booking:${row.a.id}`, requestId: randomUUID(),
        ...(rule ? { purchaseAmountMinor: input.purchaseAmountMinor ?? row.a.priceMinor, ruleVersionId: rule.id } : { quantity: 1 }),
      });
      await setStatus(tx, row, "done", { doneLedgerEntryId: award.entryId });
      doneAward = { balance: award.balance, creditedQuantity: award.creditedQuantity };
    } else {
      await setStatus(tx, row, input.to, input.to === "cancelled_by_shop" ? { cancelledAt: now, cancelReason: input.reason || "Vom Geschäft abgesagt" } : {});
      if (input.to === "confirmed") await scheduleReminders(tx, row.a.id, now);
      if (input.to === "cancelled_by_shop") await notifyShopChange(tx, row.a.id, "shop_cancel", now);
    }
    if (input.to === "no_show") {
      const [settings, after] = [await settingsOf(tx, input, false), await ownerAppointment(tx, input, row.a.id)];
      if (blocksAfterNoShow(after.noShowCount, settings.noShowBlockAfter)) {
        await tx.insert(bookingBlockedCustomers).values({ tenantId: input.tenantId, membershipId: row.a.membershipId, reason: "Nicht erschienen" }).onConflictDoNothing();
      }
    }
    const view = ownerView(await ownerAppointment(tx, input, row.a.id), now);
    return doneAward ? { ...view, doneAward } : view;
  });
}

/** The owner moves an appointment to another start or staff member; lead time and the booking window do not apply. */
export async function move(input: Scope & { appointmentId: string; start: Date; staffId: string }, now = new Date()) {
  return db.transaction(async tx => {
    await lockLocation(tx, input.locationId);
    const row = await ownerAppointment(tx, input, input.appointmentId);
    if (!isOpen(row.a.status)) throw new DomainError("STALE", "The appointment has changed; reload");
    const scope = { ...input, timezone: await timezoneOf(tx, input) };
    const service = bookedService(row);
    const { slot, nextFree } = await findSlot(tx, scope, { service, staffId: input.staffId, start: input.start, excludeId: row.a.id, settings: { leadTimeMin: 0, maxDaysAhead: 180 }, now });
    await moveRow(tx, row, slot.staffId, input.start, service).catch(slotTaken(nextFree));
    await scheduleReminders(tx, row.a.id, now);
    await notifyShopChange(tx, row.a.id, "moved", now);
    return ownerView(await ownerAppointment(tx, input, row.a.id), now);
  });
}

const openInside = (scope: Scope, block: { staffId: string | null; start: Date; end: Date }) => and(
  eq(bookingAppointments.tenantId, scope.tenantId), eq(bookingAppointments.locationId, scope.locationId), inArray(bookingAppointments.status, OPEN),
  sql`${bookingAppointments.during} && ${range(block.start, block.end)}`, block.staffId ? eq(bookingAppointments.staffId, block.staffId) : undefined);

/** Blocks time and lists the open appointments inside it; nothing is cancelled without cancelAffected. */
export async function createBlock(input: Scope & { staffId?: string; start: Date; end: Date; reason: string }, now = new Date()) {
  return db.transaction(async tx => {
    await lockLocation(tx, input.locationId);
    if (input.staffId) {
      const [staff] = await tx.select({ id: bookingStaff.id }).from(bookingStaff).where(and(eq(bookingStaff.tenantId, input.tenantId), eq(bookingStaff.locationId, input.locationId), eq(bookingStaff.id, input.staffId)));
      if (!staff) throw new DomainError("NOT_FOUND", "Staff member not found");
    }
    const [block] = await tx.insert(bookingBlocks).values({ tenantId: input.tenantId, locationId: input.locationId, staffId: input.staffId ?? null, during: range(input.start, input.end), reason: input.reason }).returning({ id: bookingBlocks.id });
    const affected = await appointmentRows(tx, openInside(input, { staffId: input.staffId ?? null, start: input.start, end: input.end }));
    return { block: { id: block.id, staffId: input.staffId ?? null, start: input.start.toISOString(), end: input.end.toISOString(), reason: input.reason }, affected: affected.map(row => ownerView(row, now)) };
  });
}

export async function deleteBlock(input: Scope & { blockId: string }) {
  const deleted = await db.delete(bookingBlocks).where(and(eq(bookingBlocks.tenantId, input.tenantId), eq(bookingBlocks.locationId, input.locationId), eq(bookingBlocks.id, input.blockId))).returning({ id: bookingBlocks.id });
  if (!deleted.length) throw new DomainError("NOT_FOUND", "Block not found");
}

export async function cancelAffected(input: Scope & { blockId: string }, now = new Date()) {
  return db.transaction(async tx => {
    await lockLocation(tx, input.locationId);
    const [block] = await tx.select({ staffId: bookingBlocks.staffId, start: lower(bookingBlocks.during), end: upper(bookingBlocks.during) }).from(bookingBlocks)
      .where(and(eq(bookingBlocks.tenantId, input.tenantId), eq(bookingBlocks.locationId, input.locationId), eq(bookingBlocks.id, input.blockId)));
    if (!block) throw new DomainError("NOT_FOUND", "Block not found");
    const cancelled = await tx.update(bookingAppointments).set({ status: "cancelled_by_shop", cancelledAt: now, cancelReason: "Geschäft geschlossen", updatedAt: now })
      .where(openInside(input, block)).returning({ id: bookingAppointments.id });
    for (const { id } of cancelled) await notifyShopChange(tx, id, "shop_cancel", now);
    return { cancelled: cancelled.length };
  });
}

async function locationCard(scope: Scope, membershipId: string) {
  const [card] = await db.select({ id: memberships.id }).from(memberships)
    .innerJoin(programs, and(eq(programs.id, memberships.programId), eq(programs.tenantId, memberships.tenantId)))
    .where(and(eq(memberships.tenantId, scope.tenantId), eq(memberships.id, membershipId), eq(programs.locationId, scope.locationId)));
  if (!card) throw new DomainError("NOT_FOUND", "Card not found");
}

export async function blockCustomer(input: Scope & { membershipId: string; userId: string; reason?: string }) {
  await locationCard(input, input.membershipId);
  await db.insert(bookingBlockedCustomers).values({ tenantId: input.tenantId, membershipId: input.membershipId, blockedByUserId: input.userId, reason: input.reason ?? "" }).onConflictDoNothing();
}

export async function unblockCustomer(input: Scope & { membershipId: string }) {
  await locationCard(input, input.membershipId);
  await db.delete(bookingBlockedCustomers).where(and(eq(bookingBlockedCustomers.tenantId, input.tenantId), eq(bookingBlockedCustomers.membershipId, input.membershipId)));
}

export async function dayView(input: Scope & { date: string }, now = new Date()) {
  const timezone = await timezoneOf(db, input);
  const from = wallToInstant(input.date, "00:00", timezone), to = wallToInstant(addDays(input.date, 1), "00:00", timezone);
  if (!from || !to) throw new DomainError("INVALID_DATE", "Invalid date");
  const scope = and(eq(bookingAppointments.tenantId, input.tenantId), eq(bookingAppointments.locationId, input.locationId));
  const appointments = await appointmentRows(db, and(scope, sql`${bookingAppointments.during} && ${range(from, to)}`));
  const blocks = await db.select({ id: bookingBlocks.id, staffId: bookingBlocks.staffId, start: lower(bookingBlocks.during), end: upper(bookingBlocks.during), reason: bookingBlocks.reason }).from(bookingBlocks)
    .where(and(eq(bookingBlocks.tenantId, input.tenantId), eq(bookingBlocks.locationId, input.locationId), sql`${bookingBlocks.during} && ${range(from, to)}`)).orderBy(asc(sql`lower(${bookingBlocks.during})`));
  const staff = await db.select({ id: bookingStaff.id, name: bookingStaff.name, sort: bookingStaff.sort }).from(bookingStaff)
    .where(and(eq(bookingStaff.tenantId, input.tenantId), eq(bookingStaff.locationId, input.locationId), isNull(bookingStaff.archivedAt))).orderBy(asc(bookingStaff.sort));
  const [pending] = await db.select({ count: sql<number>`count(*)::int` }).from(bookingAppointments)
    .where(and(scope, eq(bookingAppointments.status, "requested"), sql`upper(${bookingAppointments.during}) > ${now.toISOString()}::timestamptz`));
  return {
    date: input.date, appointments: appointments.map(row => ownerView(row, now)),
    blocks: blocks.map(b => ({ ...b, start: b.start.toISOString(), end: b.end.toISOString() })), staff, pendingRequests: pending.count,
  };
}

// ---- Cashier fusion (wired into the cashier routes in slice 4) ----------------------------------------------------------

/**
 * After a staff award: the card's open appointment at that location within ±90 minutes of the award becomes done, linked to
 * that ledger entry, without a second award. Whichever runs first (this or the owner's "Fertig") wins. Returns the id or null.
 */
export async function completeAppointmentForAward(entryId: string, reader: Reader = db) {
  const [entry] = await reader.select({ tenantId: ledgerEntries.tenantId, locationId: ledgerEntries.locationId, membershipId: ledgerEntries.membershipId, createdAt: ledgerEntries.createdAt, kind: ledgerEntries.kind, source: ledgerEntries.source })
    .from(ledgerEntries).where(eq(ledgerEntries.id, entryId));
  if (!entry || entry.kind !== "award" || entry.source !== "staff_online") return null;
  const at = entry.createdAt.toISOString();
  const { rows: [done] } = await reader.execute<{ id: string }>(sql`
    UPDATE booking_appointments SET status = 'done', done_ledger_entry_id = ${entryId}::uuid, updated_at = now()
    WHERE tenant_id = ${entry.tenantId}::uuid AND status IN ('requested','confirmed') AND id = (
      SELECT id FROM booking_appointments
      WHERE tenant_id = ${entry.tenantId}::uuid AND location_id = ${entry.locationId}::uuid AND membership_id = ${entry.membershipId}::uuid AND status IN ('requested','confirmed')
        AND lower(during) BETWEEN ${at}::timestamptz - interval '90 minutes' AND ${at}::timestamptz + interval '90 minutes'
        AND NOT EXISTS (SELECT 1 FROM booking_appointments d WHERE d.tenant_id = ${entry.tenantId}::uuid AND d.done_ledger_entry_id = ${entryId}::uuid)
      ORDER BY abs(extract(epoch FROM lower(during) - ${at}::timestamptz)) LIMIT 1)
    RETURNING id`);
  return done?.id ?? null;
}

// ---- Route helpers ------------------------------------------------------------------------------------------------------

export const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

/** Owner and manager at the selected location; cashiers and other shops get 403. `ownerOnly` for the set-up. */
export async function bookingStaffScope(request: Request, ownerOnly = false) {
  const user = await sessionUser(request);
  const context = await getMerchantContext(user.id, selectedLocationFromRequest(request, user.id));
  if (!context || context.role === "cashier" || (ownerOnly && context.role !== "owner")) throw new DomainError("FORBIDDEN", "No booking access");
  return { userId: user.id, tenantId: context.tenantId, locationId: context.locationId };
}

/** Card-token routes: the card's read limits; writes also need the same origin and have their own, lower limits. */
export async function cardBookingLimits(request: Request, token: string, write = false) {
  if (write) requireSameOrigin(request);
  await enforcePeerLimit(request, write ? "booking_write_peer" : "card_read_peer", write ? 60 : 240, 15 * 60);
  await enforceRateLimit({ scope: write ? "booking_write_token" : "card_read_token", identity: token, max: write ? 20 : 90, windowSeconds: 15 * 60 });
}

/** Path ids that are not uuids are simply not found. */
export function pathId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new DomainError("NOT_FOUND", "Not found");
  return id;
}

/** Free starts on `date` for the owner's "Verschieben": the booked length, the same staff member, no lead time (as move()). */
export async function ownerSlots(input: Scope & { appointmentId: string; date: string }, now = new Date()) {
  const row = await one(db, input.tenantId, input.appointmentId);
  if (!row || row.a.locationId !== input.locationId) throw new DomainError("NOT_FOUND", "Appointment not found");
  const scope = { ...input, timezone: await timezoneOf(db, input) };
  const [day] = await availability(db, scope, { service: bookedService(row), staffId: row.a.staffId, days: [input.date], excludeId: row.a.id, settings: { leadTimeMin: 0, maxDaysAhead: 180 }, now });
  return { date: input.date, slots: day.slots.map(s => ({ start: s.start.toISOString(), staffId: s.staffId })) };
}
