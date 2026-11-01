import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { memberships, programmeCancellationEvents, programs, staffRoles, tenants } from "@/db/schema";
import { DomainError } from "./loyalty";
import { EXPORT_DAYS_AFTER_END, germanDate } from "./programme-end-date";
import { contractBasis, noticeEnd } from "./contract-end";
import { queueContractEndEmail } from "./contract-end-email";
import { assertBillingMonthEnd, syncShopEnd } from "./billing-stripe";
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
  if (!program || !owner) throw new DomainError("NOT_FOUND", "Dieses Programm haben wir nicht gefunden.");
  return program;
}

/**
 * ENG-167 (Legal, 1 Nov: binding notice). A cancellation binds the moment it reaches us, in the app or by an e-mail the
 * operator enters with the time it arrived. It sets one end date for the whole business (pilot § 2: one contract), the
 * earliest the notice allows (contract-end.ts), on every running programme at once, so the cards show it, the end job acts
 * on it and Stripe is told without waiting for anyone. M1, the text-form confirmation, is queued in the same transaction.
 * A repeated request keeps the date already recorded and sends nothing.
 */
async function recordCancellation(tx: Transaction, input: { tenantId: string; receivedAt: Date; actorUserId: string }) {
  const active = await tx.select({ id: programs.id, end: programs.cancellationEndDate, requested: programs.cancellationRequestedAt }).from(programs)
    .where(and(eq(programs.tenantId, input.tenantId), eq(programs.status, "active"))).for("update");
  if (!active.length) throw new DomainError("PROGRAM_ENDED", "Das Programm ist bereits beendet.");
  const recorded = active.find(program => program.end !== null && program.requested !== null);
  if (recorded) {
    // A repeat is in the audit too, with the date kept; it changes nothing and sends nothing.
    await tx.insert(programmeCancellationEvents).values(active.map(program => ({ tenantId: input.tenantId, programId: program.id, action: "request", actorUserId: input.actorUserId, oldEndDate: program.end, newEndDate: recorded.end })));
    return { tenantId: input.tenantId, endDate: recorded.end!, repeated: true };
  }
  const basis = await contractBasis(input.tenantId);
  if (!basis) throw new DomainError("NOT_FOUND", "Dieses Programm haben wir nicht gefunden.");
  const requestDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(input.receivedAt);
  const { endDate } = noticeEnd({ requestDay, anchorDay: basis.anchorDay, lastFreeDay: basis.lastFreeDay });
  const now = new Date();
  await tx.update(programs).set({ cancellationEndDate: endDate, cancellationRequestedAt: input.receivedAt, cancellationConfirmedAt: now })
    .where(and(eq(programs.tenantId, input.tenantId), eq(programs.status, "active")));
  await tx.insert(programmeCancellationEvents).values(active.map(program => ({ tenantId: input.tenantId, programId: program.id, action: "request", actorUserId: input.actorUserId, oldEndDate: program.end, newEndDate: endDate })));
  await queueContractEndEmail(tx, input.tenantId, { event: "received", endDate, receivedAt: input.receivedAt.toISOString(), requestDay });
  return { tenantId: input.tenantId, endDate, repeated: false };
}

/** After the transaction: Stripe follows the date (free month: at once). The cancellation stands if Stripe fails; the daily billing job retries. */
const syncAfter = (tenantId: string, now?: Date) => syncShopEnd(tenantId, now).catch(error =>
  console.error(`Billing: Stripe end not synced for tenant ${tenantId} after a cancellation change (${error instanceof Error && "code" in error ? String(error.code) : "error"}); the daily billing job retries`));

/** The owner ends the programme („Programm beenden“): binding at once, for every location of the business. */
export async function requestCancellation(input: { actorUserId: string; programSlug: string; now?: Date }) {
  const now = input.now ?? new Date();
  const result = await db.transaction(async tx => {
    const program = await ownerProgramme(tx, input.actorUserId, input.programSlug, now);
    if (program.status !== "active") throw new DomainError("PROGRAM_ENDED", "Das Programm ist bereits beendet.");
    return recordCancellation(tx, { tenantId: program.tenantId, receivedAt: now, actorUserId: input.actorUserId });
  });
  if (!result.repeated) await syncAfter(result.tenantId, input.now);
  return { endDate: result.endDate, confirmed: true };
}

/** The shop takes its cancellation back while the programme still runs: every location continues, Stripe's end is cleared, M3 goes out. */
async function clearCancellation(tx: Transaction, tenantId: string, actorUserId: string) {
  const active = await tx.select({ id: programs.id, end: programs.cancellationEndDate }).from(programs)
    .where(and(eq(programs.tenantId, tenantId), eq(programs.status, "active"))).for("update");
  const ending = active.filter(program => program.end !== null);
  if (!ending.length) throw new DomainError("NOT_CANCELLED", "Für dieses Geschäft liegt keine Kündigung vor.");
  await tx.update(programs).set({ cancellationEndDate: null, cancellationConfirmedAt: null, cancellationRequestedAt: null })
    .where(and(eq(programs.tenantId, tenantId), eq(programs.status, "active")));
  await tx.insert(programmeCancellationEvents).values(ending.map(program => ({ tenantId, programId: program.id, action: "withdraw", actorUserId, oldEndDate: program.end, newEndDate: null })));
  await queueContractEndEmail(tx, tenantId, { event: "withdrawn", endDate: null, receivedAt: null, requestDay: null });
}

export async function withdrawCancellation(input: { actorUserId: string; programSlug: string; now?: Date }) {
  const result = await db.transaction(async tx => {
    const program = await ownerProgramme(tx, input.actorUserId, input.programSlug, input.now ?? new Date());
    if (program.status !== "active" || program.due) throw new DomainError("PROGRAM_ENDED", "Das Programm ist bereits beendet.");
    await clearCancellation(tx, program.tenantId, input.actorUserId);
    return { tenantId: program.tenantId };
  });
  // ENG-125: the shop continues, so Stripe's end is cleared. The withdrawal stands even if Stripe fails; the daily billing job repairs it.
  await syncAfter(result.tenantId, input.now);
  return { endDate: null };
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

/**
 * Operator console: show a programme's end, enter a cancellation that came by e-mail (`request`, with the time it reached
 * us), keep or move the end later (`schedule`; later only with the shop's consent in text form), withdraw it on the shop's
 * wish, or end a programme at once. One date for the whole business. Dry run unless `execute`.
 */
export async function operatorProgramme(input: { actorUserId: string; env: Env; programId: string; command: "status" | "schedule" | "end" | "request" | "withdraw"; endDate?: string; receivedAt?: string; consent?: boolean; execute: boolean; now?: Date }) {
  if (!/^[0-9a-f-]{36}$/i.test(input.programId)) throw new DomainError("NOT_FOUND", "Dieses Programm haben wir nicht gefunden.");
  const now = input.now ?? new Date();
  if (input.command === "schedule") {
    if (!realDay(input.endDate)) throw new DomainError("INVALID_END_DATE", "Dieses Datum gibt es nicht. Bitte einen Kalendertag angeben, z. B. 2026-10-31.");
    // A day that has begun would end the programme within minutes; ending now is the `end` command.
    if (input.endDate < earliestEndDate(now)) throw new DomainError("END_DATE_TOO_EARLY", END_DATE_TOO_EARLY);
  }
  let receivedAt: Date | null = null;
  if (input.command === "request") {
    // Legal: an e-mailed cancellation counts from the moment the e-mail reached us, not from when it is entered.
    receivedAt = input.receivedAt && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(input.receivedAt) ? new Date(input.receivedAt) : null;
    if (!receivedAt || Number.isNaN(receivedAt.getTime()) || receivedAt > now) throw new DomainError("INVALID_RECEIVED_AT", "Bitte den Eingang der E-Mail mit Datum, Uhrzeit und Zeitzone angeben, z. B. 2026-11-12T09:30+01:00, nicht in der Zukunft.");
  }
  const [shop] = await db.select({ tenantId: programs.tenantId }).from(programs).where(eq(programs.id, input.programId));
  // G-1 (Legal): only the last day of a billing month, or a free-month cancellation's notice end, can drive Stripe (read once, outside the lock).
  if (input.command === "schedule" && shop) await assertBillingMonthEnd(shop.tenantId, input.endDate!);
  const programme = await db.transaction(async tx => {
    await assertPlateOperator(tx, input.actorUserId, input.env);
    const [row] = await tx.select({ id: programs.id, tenantId: programs.tenantId, name: programs.name, status: programs.status, end: programs.cancellationEndDate, confirmedAt: programs.cancellationConfirmedAt, requestedAt: programs.cancellationRequestedAt }).from(programs).where(eq(programs.id, input.programId)).for("update");
    if (!row) throw new DomainError("NOT_FOUND", "Dieses Programm haben wir nicht gefunden.");
    if (!input.execute || row.status !== "active") return { row, change: null };
    if (input.command === "request") return { row, change: await recordCancellation(tx, { tenantId: row.tenantId, receivedAt: receivedAt!, actorUserId: input.actorUserId }) };
    if (input.command === "withdraw") { await clearCancellation(tx, row.tenantId, input.actorUserId); return { row, change: { withdrawn: true } }; }
    if (input.command !== "schedule") return { row, change: null };
    const active = await tx.select({ id: programs.id, end: programs.cancellationEndDate, requested: programs.cancellationRequestedAt }).from(programs)
      .where(and(eq(programs.tenantId, row.tenantId), eq(programs.status, "active"))).for("update");
    const current = active.map(program => program.end).filter((end): end is string => end !== null).sort().at(-1) ?? null;
    const requested = active.some(program => program.requested !== null);
    // Legal (1 Nov): a confirmation keeps the binding date or moves it later with the shop's consent, never earlier.
    if (requested && current && input.endDate! < current) throw new DomainError("END_DATE_EARLIER", `Das Ende kann nicht vor dem gekündigten Tag liegen (${germanDate(current)}).`);
    if (requested && current && input.endDate! > current && input.consent !== true) throw new DomainError("CONSENT_REQUIRED", "Ein späteres Ende braucht die Zustimmung des Geschäfts in Textform.");
    const moved = current !== input.endDate;
    await tx.update(programs).set({ cancellationEndDate: input.endDate, cancellationConfirmedAt: new Date() }).where(and(eq(programs.tenantId, row.tenantId), eq(programs.status, "active")));
    // "confirm" keeps the date a request set; "schedule" sets the operator's own date or moves one later.
    await tx.insert(programmeCancellationEvents).values(active.map(program => ({ tenantId: row.tenantId, programId: program.id, action: requested && !moved ? "confirm" : "schedule", actorUserId: input.actorUserId, oldEndDate: program.end, newEndDate: input.endDate! })));
    if (requested && moved) await queueContractEndEmail(tx, row.tenantId, { event: "changed", endDate: input.endDate!, receivedAt: null, requestDay: null });
    return { row, change: { moved } };
  });
  const row = programme.row;
  if (input.command === "status") {
    // A cancellation binds from its arrival; "requested" = the operator hasn't kept or moved it yet (offene zuerst).
    const [last] = await db.select({ action: programmeCancellationEvents.action }).from(programmeCancellationEvents)
      .where(and(eq(programmeCancellationEvents.programId, row.id), sql`${programmeCancellationEvents.action} in ('request', 'confirm', 'schedule')`))
      .orderBy(sql`${programmeCancellationEvents.createdAt} desc`, sql`${programmeCancellationEvents.id} desc`).limit(1);
    return { result: "status" as const, ...row, state: row.end === null ? "none" as const : last?.action === "request" || !row.confirmedAt ? "requested" as const : "confirmed" as const };
  }
  if (row.status !== "active") return { result: "unchanged" as const, ...row };
  if (!input.execute) {
    // The dry run of an e-mailed cancellation names the date it will bind.
    if (input.command === "request" && shop) {
      const basis = await contractBasis(shop.tenantId);
      const requestDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(receivedAt!);
      return { result: "would_request" as const, ...row, endDate: basis ? noticeEnd({ requestDay, anchorDay: basis.anchorDay, lastFreeDay: basis.lastFreeDay }).endDate : null };
    }
    return { result: `would_${input.command}` as const, ...row, endDate: input.endDate };
  }
  // ENG-125: Stripe follows. For `schedule` a Stripe failure reaches the operator; the date stands, and running the command
  // again or the daily billing job finishes it.
  if (input.command === "schedule") {
    await syncShopEnd(row.tenantId, input.now);
    return { result: "schedule" as const, ...row, endDate: input.endDate };
  }
  if (input.command === "request" || input.command === "withdraw") {
    await syncAfter(row.tenantId, input.now);
    return { result: input.command, ...row, ...(programme.change ?? {}) };
  }
  const ended = await endProgramme({ programId: row.id, actorUserId: input.actorUserId, force: true });
  await syncShopEnd(row.tenantId, input.now);
  return { result: ended ? "end" as const : "unchanged" as const, ...row, unlinkedPlates: ended?.unlinkedPlates };
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

export { EXPORT_DAYS_AFTER_END };

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
