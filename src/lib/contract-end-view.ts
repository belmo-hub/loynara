import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { programs, staffRoles } from "@/db/schema";
import { contractBasis, contractFacts, customerText, factsLines, laterEnds, noticeEnd, withdrawalBillingLine } from "./contract-end";
import { addDays } from "./programme-end-date";
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
  // An end the operator set without a request (Design blocking 6): shown as recorded, with its facts, never as „open“.
  const planned = recorded.length ? null : active.filter(row => row.end).map(row => row.end!).sort().at(-1) ?? null;
  const requestedAt = recorded.length ? new Date(Math.min(...recorded.map(row => row.requested!.getTime()))) : null;
  const requestDay = berlinDay(requestedAt ?? now);
  const binding = noticeEnd({ requestDay, anchorDay: basis.anchorDay, lastFreeDay: basis.lastFreeDay });
  const endDate = recorded.length ? recorded.map(row => row.end!).sort().at(-1)! : planned ?? binding.endDate;
  const facts = await contractFacts(program.tenantId, endDate, now, requestDay);
  const lines = factsLines(facts!, vatMode(), input.env ?? process.env);
  const unit = program.type === "stamp" ? "Stempel" as const : "Punkte" as const;
  // Why this day (O2 late notice, O3 free month), only before the cancellation and only where it differs from the plain case.
  const reason = binding.freeMonth ? `Du bist im kostenlosen ersten Monat. Kündigst du jetzt, kostet dich das nichts. Dein Programm läuft noch bis einschließlich ${day(binding.endDate)}, damit deine Kunden das Ende mindestens 14 Tage vorher auf ihrer Karte sehen.`
    : binding.late ? `Du kannst mit 14 Tagen Frist zum letzten Tag eines Abrechnungsmonats kündigen. Für ein Ende am ${day(binding.late.missedEnd)} hätte die Kündigung bis zum ${day(binding.late.cutoff)} bei uns sein müssen. Darum endet dein Vertrag am ${day(binding.endDate)}.` : null;
  return {
    state: recorded.length ? endDate > binding.endDate ? "later" as const : "cancelled" as const : planned ? "planned" as const : "open" as const,
    requestedOn: requestedAt ? day(requestDay) : null,
    endDate,
    endDateText: day(endDate),
    facts: lines,
    reason: recorded.length || planned ? null : reason,
    locations: basis.locations.length > 1 ? `Gilt für alle deine Standorte: ${list(basis.locations)} enden am selben Tag.` : null,
    customerText: customerText(unit, endDate),
    unit,
    withdrawal: { text: ["Dein Programm läuft dann ohne Enddatum weiter.", withdrawalBillingLine(basis, berlinDay(now))].filter(Boolean).join(" ") },
  };
}

/**
 * ENG-167 (b), operator „Kündigungen“: one entry per business (one contract), with the facts line (C24, C25, C41), the badge
 * (C40, or „bestätigt bis“ once the operator kept the date), the deadline badge on paid ends not yet acknowledged, and the
 * choices the end-date sheet offers: the binding date (C42; in the free month the only one, C31), and later ends behind the
 * consent disclosure (C29, C30), each with the facts its preview shows (C32). Nothing earlier is ever offered (Legal).
 */
export async function operatorCancellations(now = new Date(), env: Record<string, string | undefined> = process.env) {
  const rows = await db.execute(sql`SELECT p.tenant_id AS "tenantId", t.name AS tenant, array_agg(DISTINCT l.name) AS locations, min(p.id::text) AS "programId",
      max(p.cancellation_end_date)::text AS "endDate", min(p.cancellation_requested_at) AS "requestedAt",
      (SELECT e.action FROM programme_cancellation_events e WHERE e.tenant_id = p.tenant_id AND e.action IN ('request', 'confirm', 'schedule') ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS "lastAction"
    FROM programs p JOIN tenants t ON t.id = p.tenant_id JOIN locations l ON l.tenant_id = p.tenant_id AND l.id = p.location_id
    WHERE p.status = 'active' AND p.cancellation_end_date IS NOT NULL GROUP BY p.tenant_id, t.name ORDER BY t.name`);
  const today = berlinDay(now);
  const out = [];
  for (const row of rows.rows as Array<{ tenantId: string; tenant: string; locations: string[]; programId: string; endDate: string; requestedAt: Date | null; lastAction: string | null }>) {
    const basis = await contractBasis(row.tenantId);
    if (!basis) continue;
    const requestDay = row.requestedAt ? berlinDay(new Date(row.requestedAt)) : today;
    const binding = noticeEnd({ requestDay, anchorDay: basis.anchorDay, lastFreeDay: basis.lastFreeDay });
    const acknowledged = row.lastAction !== "request";
    const factsFor = async (endDate: string) => factsLines((await contractFacts(row.tenantId, endDate, now, requestDay))!, vatMode(), env);
    const current = await factsFor(row.endDate);
    const days = row.requestedAt ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${requestDay}T00:00:00Z`)) / 86_400_000) : null;
    const origin = days === null ? "vom Operator geplant" : days === 0 ? "heute angefragt" : days === 1 ? "gestern angefragt" : `vor ${days} Tagen angefragt`;
    const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
    const free = binding.freeMonth && row.endDate <= binding.endDate;
    // C41 only when Stripe holds the end (billing_ends_at, ENG-125); otherwise a failed cancel must be visible.
    const [held] = (await db.execute(sql`SELECT billing_ends_at IS NOT NULL AS held FROM subscriptions WHERE tenant_id = ${row.tenantId}`)).rows as Array<{ held: boolean }>;
    const stripeEnded = !!held?.held;
    const factsLine = free
      ? `${origin} · kostenloser Monat · keine Rechnung${basis.billed && stripeEnded ? " · Stripe-Abo beendet" : ""} · Export bis ${current.exportUntil.value}`
      : `${origin} · Abrechnung am ${basis.anchorDay}. · ${lower(current.lastInvoice.value)} · Export bis ${current.exportUntil.value}`;
    // The binding date first, or the end already agreed later („Wie bisher“, Design P5); later ends only with the shop's consent,
    // never in the free month, and nothing earlier is ever offered (Legal: the one binding date).
    const bindingEnd = row.requestedAt ? binding.endDate : row.endDate;
    const base = row.endDate > bindingEnd ? row.endDate : bindingEnd;
    const kept = base === bindingEnd
      ? free ? (bindingEnd === basis.lastFreeDay ? "Ende des kostenlosen Monats · keine Rechnung" : "Wie gekündigt · keine Rechnung") : `${row.requestedAt ? "Wie gekündigt" : "Wie geplant"} · ${lower((await factsFor(bindingEnd)).lastInvoice.value)}`
      : `Wie bisher · ${lower((await factsFor(base)).lastInvoice.value)}`;
    const choices = [{ endDate: base, label: `${day(base)} · ${kept}`, consent: false, facts: await factsFor(base) }];
    if (!free) for (const end of laterEnds(base, basis.anchorDay, 3)) {
      const facts = await contractFacts(row.tenantId, end, now, requestDay);
      const extra = facts && facts.invoice.kind === "due" ? facts.invoice.invoices.filter(invoice => invoice.date > base) : [];
      const amount = factsLinesAmount(extra[0]?.amountMinor ?? basis.totalMinor ?? 0);
      // Unbilled shops (live billing off) owe nothing for a later end.
      const label = extra.length === 0 ? "keine Rechnung" : extra.length === 1 ? `Eine Rechnung mehr: ${day(extra[0].date)}, ${amount}` : `${["Zwei", "Drei"][extra.length - 2] ?? extra.length} Rechnungen mehr: ${extra.map(invoice => day(invoice.date)).join(", ").replace(/, ([^,]*)$/, " und $1")}, je ${amount}`;
      choices.push({ endDate: end, label: `${day(end)} · ${label}`, consent: true, facts: factsLines(facts!, vatMode(), env) });
    }
    out.push({
      tenantId: row.tenantId, tenant: row.tenant, locations: row.locations, programId: row.programId, endDate: row.endDate, endText: day(row.endDate),
      acknowledged, freeMonth: free, factsLine, origin, stripeNotEnded: free && basis.billed && !stripeEnded,
      badge: acknowledged ? `bestätigt bis ${day(row.endDate)}` : `gekündigt zum ${day(row.endDate)}`,
      deadline: !acknowledged && !free ? `bestätigen bis ${day(addDays(row.endDate, -1))}` : null,
      requestedOn: row.requestedAt ? day(requestDay) : null, anchorDay: basis.anchorDay, choices,
      withdrawal: `Das Programm von ${row.tenant} läuft dann ohne Enddatum weiter. ${withdrawalBillingLine(basis, today) ?? ""} Das Geschäft bekommt eine E-Mail.`.replace(/\s+/g, " ").replace("weiter. Die Abrechnung bleibt wie bisher:", "weiter. Die Abrechnung bleibt:"),
    });
  }
  // Open ones first, then by end date (C39).
  return out.sort((a, b) => Number(a.acknowledged) - Number(b.acknowledged) || a.endDate.localeCompare(b.endDate));
}

const factsLinesAmount = (minor: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
