import { and, asc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { bookingAppointments, bookingServices, bookingSettings, bookingStaff, bookingStaffServices, staffRoles } from "@/db/schema";
import { DomainError } from "@/lib/loyalty";
import { BookingError, lockLocation, type Reader, type Tx } from "./appointments";
import { PRESETS } from "./presets";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/);
const span = z.object({ start: time, end: time }).refine(s => s.end > s.start, "End must be after start");
const workingDay = z.object({ weekday: z.number().int().min(1).max(7), start: time, end: time, breaks: z.array(span).max(4) }).refine(d => d.end > d.start, "End must be after start");

export const setupInput = z.object({
  settings: z.object({
    shopType: z.enum(["nagelstudio", "barber", "kosmetik"]),
    goalText: z.string().trim().max(140).default(""),
    leadTimeMin: z.number().int().min(0).max(1440),
    maxDaysAhead: z.number().int().min(1).max(180),
    cancelDeadlineHours: z.number().int().min(0).max(168),
    maxReschedulesPerMonth: z.number().int().min(0).max(10),
    autoConfirm: z.boolean(),
    noShowBlockAfter: z.number().int().min(0).max(10),
    maxOpenPerCard: z.number().int().min(1).max(5),
    termsText: z.string().trim().max(600).default(""),
  }),
  services: z.array(z.object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(80),
    durationMin: z.number().int().min(5).max(480).multipleOf(5),
    bufferMin: z.number().int().min(0).max(60).default(0),
    priceMinor: z.number().int().min(0).max(100000),
    priceFrom: z.boolean().default(false),
    rebookAfterDays: z.number().int().min(0).max(365).default(0),
  })).max(50),
  staff: z.array(z.object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(60),
    userId: z.string().max(100).nullable().default(null),
    workingHours: z.array(workingDay).max(14),
    // Existing service ids only; empty = offers every service.
    serviceIds: z.array(z.uuid()).max(50).default([]),
  })).max(30),
});

type Scope = { tenantId: string; locationId: string };

export async function getSetup(scope: Scope, reader: Reader = db) {
  const [settings] = await reader.select().from(bookingSettings).where(and(eq(bookingSettings.tenantId, scope.tenantId), eq(bookingSettings.locationId, scope.locationId)));
  const services = await reader.select().from(bookingServices)
    .where(and(eq(bookingServices.tenantId, scope.tenantId), eq(bookingServices.locationId, scope.locationId), isNull(bookingServices.archivedAt))).orderBy(asc(bookingServices.sort), asc(bookingServices.createdAt));
  const staff = await reader.select().from(bookingStaff)
    .where(and(eq(bookingStaff.tenantId, scope.tenantId), eq(bookingStaff.locationId, scope.locationId), isNull(bookingStaff.archivedAt))).orderBy(asc(bookingStaff.sort), asc(bookingStaff.createdAt));
  const links = staff.length ? await reader.select().from(bookingStaffServices).where(and(eq(bookingStaffServices.tenantId, scope.tenantId), inArray(bookingStaffServices.staffId, staff.map(s => s.id)))) : [];
  return {
    settings: settings ?? null,
    services,
    staff: staff.map(s => ({ ...s, serviceIds: links.filter(l => l.staffId === s.id).map(l => l.serviceId) })),
    presets: PRESETS,
  };
}

/** Upserts by id and archives what the owner removed; `enabled` is left to the plan gate. Archiving staff with open appointments is refused. */
export async function saveSetup(scope: Scope, raw: z.input<typeof setupInput>) {
  const input = setupInput.parse(raw);
  return db.transaction(async tx => {
    await lockLocation(tx, scope.locationId);
    const now = new Date();
    await tx.insert(bookingSettings).values({ ...scope, ...input.settings, setupDoneAt: now })
      .onConflictDoUpdate({ target: [bookingSettings.tenantId, bookingSettings.locationId], set: { ...input.settings, updatedAt: now } });

    const services = await upsert(tx, scope, bookingServices, input.services, "Service");
    const staffIds = input.staff.flatMap(s => s.id ? [s.id] : []);
    const leaving = await tx.select({ staffId: bookingAppointments.staffId, count: sql<number>`count(*)::int` }).from(bookingAppointments)
      .innerJoin(bookingStaff, and(eq(bookingStaff.tenantId, bookingAppointments.tenantId), eq(bookingStaff.id, bookingAppointments.staffId)))
      .where(and(eq(bookingAppointments.tenantId, scope.tenantId), eq(bookingAppointments.locationId, scope.locationId), isNull(bookingStaff.archivedAt),
        staffIds.length ? notInArray(bookingAppointments.staffId, staffIds) : sql`true`, inArray(bookingAppointments.status, ["requested", "confirmed"]), sql`upper(${bookingAppointments.during}) > now()`))
      .groupBy(bookingAppointments.staffId).limit(1);
    if (leaving[0]) throw new BookingError("STAFF_HAS_APPOINTMENTS", "Staff member still has open appointments", { staffId: leaving[0].staffId, count: leaving[0].count });
    // A staff row links only to a login of this shop: the owner, or a team member at this location.
    const userIds = [...new Set(input.staff.flatMap(s => s.userId ? [s.userId] : []))];
    if (userIds.length) {
      const known = await tx.select({ userId: staffRoles.userId }).from(staffRoles).where(and(eq(staffRoles.tenantId, scope.tenantId), eq(staffRoles.active, true), inArray(staffRoles.userId, userIds),
        or(eq(staffRoles.role, "owner"), eq(staffRoles.locationId, scope.locationId))));
      if (known.length !== userIds.length) throw new DomainError("INVALID_STAFF_USER", "Unknown team member for this location");
    }
    const staff = await upsert(tx, scope, bookingStaff, input.staff.map(s => ({ id: s.id, name: s.name, userId: s.userId, workingHours: s.workingHours })), "Staff member");

    const serviceIds = new Set(services);
    for (const [index, member] of input.staff.entries()) {
      if (member.serviceIds.some(id => !serviceIds.has(id))) throw new DomainError("INVALID_SERVICE", "Unknown service for this location");
      await tx.delete(bookingStaffServices).where(and(eq(bookingStaffServices.tenantId, scope.tenantId), eq(bookingStaffServices.staffId, staff[index])));
      if (member.serviceIds.length) await tx.insert(bookingStaffServices).values(member.serviceIds.map(serviceId => ({ tenantId: scope.tenantId, staffId: staff[index], serviceId })));
    }
    return getSetup(scope, tx);
  });
}

// Updates rows by id inside this location, inserts the rest, archives the location's other live rows; returns ids in input order.
async function upsert(tx: Tx, scope: Scope, table: typeof bookingServices | typeof bookingStaff, rows: { id?: string }[], label: string) {
  const ids: string[] = [];
  for (const [sort, { id, ...values }] of rows.entries()) {
    const set = { ...values, sort };
    const [row] = id
      ? await tx.update(table).set(set).where(and(eq(table.tenantId, scope.tenantId), eq(table.locationId, scope.locationId), eq(table.id, id), isNull(table.archivedAt))).returning({ id: table.id })
      : await tx.insert(table).values({ ...scope, ...set } as never).returning({ id: table.id }); // rows were validated by setupInput for this table
    if (!row) throw new DomainError("NOT_FOUND", `${label} not found`);
    ids.push(row.id);
  }
  await tx.update(table).set({ archivedAt: new Date() })
    .where(and(eq(table.tenantId, scope.tenantId), eq(table.locationId, scope.locationId), isNull(table.archivedAt), ids.length ? notInArray(table.id, ids) : sql`true`));
  return ids;
}
