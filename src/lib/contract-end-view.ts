import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { programs, staffRoles } from "@/db/schema";
import { contractBasis, contractFacts, customerText, factsLines, noticeEnd, withdrawalBillingLine } from "./contract-end";
import { DomainError } from "./loyalty";
import { vatMode } from "./stripe-config";

const berlinDay = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(at);
const day = (iso: string) => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const list = (names: string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} und ${names.at(-1)}`;

/**
 * ENG-167 (b): everything the owner's „Programm beenden“ page shows, from the server, in Marketing's and Legal's final words
 * (strings C1–C38), so the page, the operator preview and the emails never disagree. Before a cancellation it previews the
 * binding end a cancellation now would get; after it, the end recorded for the business.
 */
export async function ownerContractView(input: { actorUserId: string; programSlug: string; now?: Date; env?: Record<string, string | undefined> }) {
  const now = input.now ?? new Date();
  const [program] = await db.select({ tenantId: programs.tenantId, status: programs.status, type: programs.type }).from(programs).where(eq(programs.slug, input.programSlug));
  const [owner] = program ? await db.select({ userId: staffRoles.userId }).from(staffRoles)
    .where(and(eq(staffRoles.tenantId, program.tenantId), eq(staffRoles.userId, input.actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))) : [];
  if (!program || !owner) throw new DomainError("NOT_FOUND", "Dieses Programm haben wir nicht gefunden.");
  if (program.status !== "active") throw new DomainError("PROGRAM_ENDED", "Das Programm ist bereits beendet.");
  const basis = await contractBasis(program.tenantId);
  if (!basis) throw new DomainError("NOT_FOUND", "Dieses Programm haben wir nicht gefunden.");
  const active = await db.select({ end: programs.cancellationEndDate, requested: programs.cancellationRequestedAt }).from(programs)
    .where(and(eq(programs.tenantId, program.tenantId), eq(programs.status, "active")));
  const recorded = active.filter(row => row.end && row.requested);
  const requestedAt = recorded.length ? new Date(Math.min(...recorded.map(row => row.requested!.getTime()))) : null;
  const requestDay = berlinDay(requestedAt ?? now);
  const binding = noticeEnd({ requestDay, anchorDay: basis.anchorDay, lastFreeDay: basis.lastFreeDay });
  const endDate = recorded.length ? recorded.map(row => row.end!).sort().at(-1)! : binding.endDate;
  const facts = await contractFacts(program.tenantId, endDate, now, requestDay);
  const lines = factsLines(facts!, vatMode(), input.env ?? process.env);
  const unit = program.type === "stamp" ? "Stempel" as const : "Punkte" as const;
  // Why this day (O2 late notice, O3 free month), only before the cancellation and only where it differs from the plain case.
  const reason = binding.freeMonth ? `Du bist im kostenlosen ersten Monat. Kündigst du jetzt, kostet dich das nichts. Dein Programm läuft noch bis einschließlich ${day(binding.endDate)}, damit deine Kunden das Ende mindestens 14 Tage vorher auf ihrer Karte sehen.`
    : binding.late ? `Du kannst mit 14 Tagen Frist zum letzten Tag eines Abrechnungsmonats kündigen. Für ein Ende am ${day(binding.late.missedEnd)} hätte die Kündigung bis zum ${day(binding.late.cutoff)} bei uns sein müssen. Darum endet dein Vertrag am ${day(binding.endDate)}.` : null;
  return {
    state: recorded.length ? endDate > binding.endDate ? "later" as const : "cancelled" as const : "open" as const,
    requestedOn: requestedAt ? day(requestDay) : null,
    endDate,
    endDateText: day(endDate),
    facts: lines,
    reason: recorded.length ? null : reason,
    locations: basis.locations.length > 1 ? `Gilt für alle deine Standorte: ${list(basis.locations)} enden am selben Tag.` : null,
    customerText: customerText(unit, endDate),
    unit,
    withdrawal: { text: ["Dein Programm läuft dann ohne Enddatum weiter.", withdrawalBillingLine(basis, berlinDay(now))].filter(Boolean).join(" ") },
  };
}
