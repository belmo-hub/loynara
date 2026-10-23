import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { memberships, programmeCancellationEvents, programs, staffRoles, tenants } from "@/db/schema";
import { DomainError } from "./loyalty";
import { cancellationEnd, germanDate } from "./programme-end-date";
import { assertPlateOperator, unlinkProgrammePlates } from "./plates";
import { earliestEndDate, END_DATE_TOO_EARLY } from "./operator-date";

/**
 * Programme cancellation. There is no live billing, so cancelling records an END DATE: the last Berlin calendar day the
 * programme works (the last day of the current month unless the operator sets another). Until the end of that day
 * everything runs as normal. After it the worker ends the programme (status "ended": every award, redemption and tap
 * already refuses a programme that is not "active"), and unlinks its plates. Balances and history are never touched.
 */
export const PROGRAMME_END_ACTOR = "system:programme-end";
type Env = Record<string, string | undefined>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** True from the first instant (and only once the operator has confirmed the date) after the end date's last Berlin day (DST-safe: Postgres does the zone arithmetic). */
const dueSql = (now: Date) => sql<boolean>`${programs.cancellationConfirmedAt} IS NOT NULL AND ${now.toISOString()}::timestamptz >= ((${programs.cancellationEndDate} + 1)::timestamp AT TIME ZONE 'Europe/Berlin')`;

async function ownerProgramme(tx: Transaction, actorUserId: string, programSlug: string, now: Date) {
  const [program] = await tx.select({ id: programs.id, tenantId: programs.tenantId, status: programs.status, end: programs.cancellationEndDate, confirmed: programs.cancellationConfirmedAt, requested: programs.cancellationRequestedAt, due: dueSql(now) }).from(programs).where(eq(programs.slug, programSlug)).for("update");
  const [owner] = program ? await tx.select({ userId: staffRoles.userId }).from(staffRoles).where(and(eq(staffRoles.tenantId, program.tenantId), eq(staffRoles.userId, actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))) : [];
  // Not an owner of this shop: the same answer as a programme that does not exist.
  if (!program || !owner) throw new DomainError("NOT_FOUND", "Program not found");
  return program;
}

/** The owner asks to end the programme at the end of this month (or the next, under the minimum notice). Repeating it keeps the date already recorded. */
export async function requestCancellation(input: { actorUserId: string; programSlug: string; now?: Date }) {
  return db.transaction(async tx => {
    const program = await ownerProgramme(tx, input.actorUserId, input.programSlug, input.now ?? new Date());
    if (program.status !== "active") throw new DomainError("PROGRAM_ENDED", "Das Programm ist bereits beendet.");
    // Provisional: only the operator's confirmation (scripts/operator-programme.ts schedule) lets the end job act.
    const fresh = program.end ? { endDate: program.end, nextMonth: false } : cancellationEnd(input.now ?? new Date());
    await tx.update(programs).set({ cancellationEndDate: fresh.endDate, cancellationRequestedAt: program.requested ?? new Date() }).where(eq(programs.id, program.id));
    await tx.insert(programmeCancellationEvents).values({ tenantId: program.tenantId, programId: program.id, action: "request", actorUserId: input.actorUserId, oldEndDate: program.end, newEndDate: fresh.endDate });
    return { ...fresh, confirmed: program.confirmed !== null };
  });
}

export async function withdrawCancellation(input: { actorUserId: string; programSlug: string; now?: Date }) {
  return db.transaction(async tx => {
    const program = await ownerProgramme(tx, input.actorUserId, input.programSlug, input.now ?? new Date());
    if (program.status !== "active" || program.due) throw new DomainError("PROGRAM_ENDED", "Das Programm ist bereits beendet.");
    await tx.update(programs).set({ cancellationEndDate: null, cancellationConfirmedAt: null, cancellationRequestedAt: null }).where(eq(programs.id, program.id));
    await tx.insert(programmeCancellationEvents).values({ tenantId: program.tenantId, programId: program.id, action: "withdraw", actorUserId: input.actorUserId, oldEndDate: program.end, newEndDate: null });
    return { endDate: null };
  });
}

/**
 * Ends one programme and unlinks its plates, in one transaction. Idempotent and exactly once: the programme row is
 * locked first (the order every tap takes), and a programme that is no longer active, or whose date has not passed
 * (unless `force`, the operator's immediate end), is left alone.
 */
export async function endProgramme(input: { programId: string; actorUserId: string; now?: Date; force?: boolean }) {
  return db.transaction(async tx => {
    const [program] = await tx.select({ tenantId: programs.tenantId, status: programs.status, end: programs.cancellationEndDate, due: dueSql(input.now ?? new Date()) }).from(programs).where(eq(programs.id, input.programId)).for("update");
    if (!program || program.status !== "active" || (!input.force && !program.due)) return null;
    // An immediate end by the operator still gets a confirmed end date (today, Berlin, replacing any provisional or confirmed date): the owner's export window counts from it.
    const [ended] = await tx.update(programs).set({ status: "ended", ...(input.force ? { cancellationEndDate: sql`(now() AT TIME ZONE 'Europe/Berlin')::date`, cancellationConfirmedAt: sql`coalesce(${programs.cancellationConfirmedAt}, now())` } : {}) }).where(eq(programs.id, input.programId)).returning({ end: programs.cancellationEndDate });
    await tx.insert(programmeCancellationEvents).values({ tenantId: program.tenantId, programId: input.programId, action: "end", actorUserId: input.actorUserId, oldEndDate: program.end, newEndDate: ended.end });
    return { unlinkedPlates: await unlinkProgrammePlates(tx, input.programId, input.actorUserId) };
  });
}

/** The worker's tick: ends every programme whose last day has passed. Returns how many it ended. */
export async function endDueProgrammes(now = new Date()) {
  const due = await db.select({ id: programs.id }).from(programs).where(and(eq(programs.status, "active"), dueSql(now)));
  let ended = 0;
  for (const { id } of due) if (await endProgramme({ programId: id, actorUserId: PROGRAMME_END_ACTOR, now })) ended += 1;
  return ended;
}

const isoDay = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day: the format alone lets 2026-02-30 through, which Date rolls to 2 March and Postgres refuses. */
const realDay = (day?: string): day is string => !!day && isoDay.test(day) && !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().startsWith(day);

/** Operator console: show, confirm (or move) the end date, or end a programme at once. Dry run unless `execute`. */
export async function operatorProgramme(input: { actorUserId: string; env: Env; programId: string; command: "status" | "schedule" | "end"; endDate?: string; execute: boolean; now?: Date }) {
  if (!/^[0-9a-f-]{36}$/i.test(input.programId)) throw new DomainError("NOT_FOUND", "Programme not found");
  if (input.command === "schedule") {
    if (!realDay(input.endDate)) throw new DomainError("INVALID_END_DATE", "Dieses Datum gibt es nicht. Bitte einen Kalendertag angeben, z. B. 2026-10-31.");
    // A day that has begun would end the programme within minutes; ending now is the `end` command.
    if (input.endDate < earliestEndDate(input.now ?? new Date())) throw new DomainError("END_DATE_TOO_EARLY", END_DATE_TOO_EARLY);
  }
  const programme = await db.transaction(async tx => {
    await assertPlateOperator(tx, input.actorUserId, input.env);
    const [row] = await tx.select({ id: programs.id, tenantId: programs.tenantId, name: programs.name, status: programs.status, end: programs.cancellationEndDate, confirmedAt: programs.cancellationConfirmedAt, requestedAt: programs.cancellationRequestedAt }).from(programs).where(eq(programs.id, input.programId)).for("update");
    if (!row) throw new DomainError("NOT_FOUND", "Programme not found");
    if (input.command === "schedule" && input.execute && row.status === "active") {
      await tx.update(programs).set({ cancellationEndDate: input.endDate, cancellationConfirmedAt: new Date() }).where(eq(programs.id, row.id));
      // "confirm" answers an owner's open request; "schedule" sets a date of the operator's own or moves a confirmed one.
      await tx.insert(programmeCancellationEvents).values({ tenantId: row.tenantId, programId: row.id, action: row.end !== null && row.confirmedAt === null ? "confirm" : "schedule", actorUserId: input.actorUserId, oldEndDate: row.end, newEndDate: input.endDate! });
    }
    return row;
  });
  if (input.command === "status") return { result: "status" as const, ...programme, state: programme.end === null ? "none" as const : programme.confirmedAt ? "confirmed" as const : "requested" as const };
  if (programme.status !== "active") return { result: "unchanged" as const, ...programme };
  if (!input.execute) return { result: `would_${input.command}` as const, ...programme, endDate: input.endDate };
  if (input.command === "schedule") return { result: "schedule" as const, ...programme, endDate: input.endDate };
  const ended = await endProgramme({ programId: programme.id, actorUserId: input.actorUserId, force: true });
  return { result: ended ? "end" as const : "unchanged" as const, ...programme, unlinkedPlates: ended?.unlinkedPlates };
}

/** Customer pages: has this programme ended? A plate unlinked by the end job no longer names its programme, so the programme named by its last audit row says so (whether the job or the operator unlinked it). */
export async function programmeEnded(by: { slug: string } | { cardToken: string } | { tapRef: string } | { plateLabel: string }) {
  const found = "slug" in by ? await db.select({ id: programs.id }).from(programs).where(and(eq(programs.slug, by.slug), eq(programs.status, "ended")))
    : "cardToken" in by ? await db.select({ id: programs.id }).from(memberships).innerJoin(programs, and(eq(programs.id, memberships.programId), eq(programs.tenantId, memberships.tenantId)))
      .where(and(eq(memberships.cardToken, by.cardToken), eq(programs.status, "ended")))
      : (await db.execute(sql`SELECT t.id FROM secure_tags t WHERE ${"tapRef" in by ? sql`t.public_ref = ${by.tapRef}` : sql`t.plate_label = ${by.plateLabel}`} AND (
          EXISTS (SELECT 1 FROM programs p WHERE p.id = t.program_id AND p.status = 'ended')
          OR (t.status = 'unlinked' AND EXISTS (SELECT 1 FROM programs p WHERE p.id = (SELECT e.old_program_id FROM plate_link_events e WHERE e.tag_id = t.id ORDER BY e.created_at DESC, e.id LIMIT 1) AND p.status = 'ended')))`)).rows;
  return found.length > 0;
}

/** The shop's name for the ended card page, or null while the card's programme is still running. */
export async function endedCardShop(cardToken: string): Promise<string | null> {
  const [row] = await db.select({ shop: tenants.name }).from(memberships)
    .innerJoin(programs, and(eq(programs.id, memberships.programId), eq(programs.tenantId, memberships.tenantId)))
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.cardToken, cardToken), eq(programs.status, "ended")));
  return row?.shop ?? null;
}

/** Days after the confirmed end date during which the owner can still log in and download the export (pilot agreement § 6 (3)). */
export const EXPORT_DAYS_AFTER_END = 30;

type Executor = Pick<Transaction, "execute">;

/** The export window of a shop with no running programme: when it ended, until when the owner can export, and whether that is still open (Berlin days). */
export async function exportWindow(executor: Executor, tenantId: string, now = new Date()) {
  const { rows } = await executor.execute(sql`SELECT count(*) FILTER (WHERE status = 'active')::int AS active,
      max(cancellation_end_date) FILTER (WHERE status = 'ended')::text AS "endedOn",
      (max(cancellation_end_date) FILTER (WHERE status = 'ended') + ${EXPORT_DAYS_AFTER_END}::int)::text AS "until",
      ((${now.toISOString()}::timestamptz AT TIME ZONE 'Europe/Berlin')::date <= max(cancellation_end_date) FILTER (WHERE status = 'ended') + ${EXPORT_DAYS_AFTER_END}::int) AS "open"
    FROM programs WHERE tenant_id = ${tenantId}`);
  const row = rows[0] as { active: number; endedOn: string | null; until: string | null; open: boolean | null };
  // Only a shop whose programmes have all ended is in a window; any running programme means normal operation.
  return row.active === 0 && row.endedOn ? { ended: true as const, endedOn: row.endedOn, until: row.until!, open: row.open === true } : { ended: false as const };
}

/** Owner exports stop 30 days after the confirmed end date of a shop whose programme has ended. */
export async function assertExportOpen(executor: Executor, tenantId: string, now = new Date()) {
  const window = await exportWindow(executor, tenantId, now);
  if (window.ended && !window.open) throw new DomainError("EXPORT_CLOSED", `Der Datenexport war bis zum ${germanDate(window.until)} möglich. Bitte wende dich an den Support.`);
}

/** What an account of a shop whose programme ended sees instead of the owner area. */
export async function endedAccount(userId: string, now = new Date()) {
  const [role] = await db.select({ tenantId: staffRoles.tenantId, role: staffRoles.role, businessName: tenants.name }).from(staffRoles)
    .innerJoin(tenants, eq(tenants.id, staffRoles.tenantId)).where(and(eq(staffRoles.userId, userId), eq(staffRoles.active, true))).limit(1);
  if (!role) return null;
  const window = await exportWindow(db, role.tenantId, now);
  return window.ended ? { tenantId: role.tenantId, role: role.role, businessName: role.businessName, endedOn: window.endedOn, exportUntil: window.until, exportOpen: window.open } : null;
}
