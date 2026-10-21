import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { memberships, programs, staffRoles } from "@/db/schema";
import { DomainError } from "./loyalty";
import { lastDayOfBerlinMonth } from "./programme-end-date";
import { assertPlateOperator, unlinkProgrammePlates } from "./plates";

/**
 * Programme cancellation. There is no live billing, so cancelling records an END DATE: the last Berlin calendar day the
 * programme works (the last day of the current month unless the operator sets another). Until the end of that day
 * everything runs as normal. After it the worker ends the programme (status "ended": every award, redemption and tap
 * already refuses a programme that is not "active"), and unlinks its plates. Balances and history are never touched.
 */
export const PROGRAMME_END_ACTOR = "system:programme-end";
type Env = Record<string, string | undefined>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** True from the first instant after the end date's last Berlin day (DST-safe: Postgres does the zone arithmetic). */
const dueSql = (now: Date) => sql<boolean>`${now.toISOString()}::timestamptz >= ((${programs.cancellationEndDate} + 1)::timestamp AT TIME ZONE 'Europe/Berlin')`;

async function ownerProgramme(tx: Transaction, actorUserId: string, programSlug: string, now: Date) {
  const [program] = await tx.select({ id: programs.id, tenantId: programs.tenantId, status: programs.status, end: programs.cancellationEndDate, due: dueSql(now) }).from(programs).where(eq(programs.slug, programSlug)).for("update");
  const [owner] = program ? await tx.select({ userId: staffRoles.userId }).from(staffRoles).where(and(eq(staffRoles.tenantId, program.tenantId), eq(staffRoles.userId, actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))) : [];
  // Not an owner of this shop: the same answer as a programme that does not exist.
  if (!program || !owner) throw new DomainError("NOT_FOUND", "Program not found");
  return program;
}

/** The owner asks to end the programme at the end of this month. Repeating it keeps the date already recorded. */
export async function requestCancellation(input: { actorUserId: string; programSlug: string; now?: Date }) {
  return db.transaction(async tx => {
    const program = await ownerProgramme(tx, input.actorUserId, input.programSlug, input.now ?? new Date());
    if (program.status !== "active") throw new DomainError("PROGRAM_ENDED", "Das Programm ist bereits beendet.");
    const endDate = program.end ?? lastDayOfBerlinMonth(input.now ?? new Date());
    await tx.update(programs).set({ cancellationEndDate: endDate }).where(eq(programs.id, program.id));
    return { endDate };
  });
}

export async function withdrawCancellation(input: { actorUserId: string; programSlug: string; now?: Date }) {
  return db.transaction(async tx => {
    const program = await ownerProgramme(tx, input.actorUserId, input.programSlug, input.now ?? new Date());
    if (program.status !== "active" || program.due) throw new DomainError("PROGRAM_ENDED", "Das Programm ist bereits beendet.");
    await tx.update(programs).set({ cancellationEndDate: null }).where(eq(programs.id, program.id));
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
    const [program] = await tx.select({ status: programs.status, due: dueSql(input.now ?? new Date()) }).from(programs).where(eq(programs.id, input.programId)).for("update");
    if (!program || program.status !== "active" || (!input.force && !program.due)) return null;
    await tx.update(programs).set({ status: "ended" }).where(eq(programs.id, input.programId));
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

/** Operator console: show, reschedule or end a programme at once. Dry run unless `execute`. */
export async function operatorProgramme(input: { actorUserId: string; env: Env; programId: string; command: "status" | "schedule" | "end"; endDate?: string; execute: boolean }) {
  if (!/^[0-9a-f-]{36}$/i.test(input.programId)) throw new DomainError("NOT_FOUND", "Programme not found");
  if (input.command === "schedule" && (!input.endDate || !isoDay.test(input.endDate) || Number.isNaN(Date.parse(input.endDate)))) throw new DomainError("INVALID_END_DATE", "End date must look like 2026-10-31");
  const programme = await db.transaction(async tx => {
    await assertPlateOperator(tx, input.actorUserId, input.env);
    const [row] = await tx.select({ id: programs.id, name: programs.name, status: programs.status, end: programs.cancellationEndDate }).from(programs).where(eq(programs.id, input.programId));
    if (!row) throw new DomainError("NOT_FOUND", "Programme not found");
    if (input.command === "schedule" && input.execute && row.status === "active") await tx.update(programs).set({ cancellationEndDate: input.endDate }).where(eq(programs.id, row.id));
    return row;
  });
  if (input.command === "status") return { result: "status" as const, ...programme };
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
