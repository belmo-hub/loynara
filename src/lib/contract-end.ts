import { eq } from "drizzle-orm";
import { db } from "@/db";
import { locations, programs, subscriptions, tenants } from "@/db/schema";
import { addDays, EXPORT_DAYS_AFTER_END, MIN_NOTICE_DAYS } from "./programme-end-date";
import { planCharge } from "./stripe-config";

/**
 * ENG-167 (pilot § 2, Legal G-1 and 1 Nov): when a shop's contract ends, and the three facts every screen and email shows
 * about it (the last day, the last invoice, the export deadline), from one function so they never disagree.
 *
 * Billing months start on the go-live day of the month (in a shorter month, its last day), so a contract ends on the day
 * before a billing day. Notice is 14 days, counted from the Berlin day the cancellation reached us. A cancellation that
 * reaches us in the free first month ends on the later of the last free day and that day + 14, and is never charged.
 */

const berlinDay = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(at);
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** The billing day in the month of `isoDay`: the anchor day, or the month's last day when it has none. */
function billingDayIn(isoDay: string, anchorDay: number) {
  const [year, month] = isoDay.split("-").map(Number);
  return `${isoDay.slice(0, 8)}${String(Math.min(anchorDay, daysIn(year, month - 1))).padStart(2, "0")}`;
}

/** Is `isoDay` the last day of a billing month, the day before a billing day? */
export function isBillingMonthEnd(isoDay: string, anchorDay: number) {
  const next = addDays(isoDay, 1);
  return next === billingDayIn(next, anchorDay);
}

/** The first billing-month end on or after `isoDay`. */
export function nextBillingMonthEnd(isoDay: string, anchorDay: number) {
  let day = isoDay;
  while (!isBillingMonthEnd(day, anchorDay)) day = addDays(day, 1);
  return day;
}

/** The billing days strictly after `after` up to and including `until`: each opens one billing month and its invoice. */
export function billingDaysBetween(after: string, until: string, anchorDay: number) {
  const days: string[] = [];
  for (let day = addDays(after, 1); day <= until; day = addDays(day, 1)) if (day === billingDayIn(day, anchorDay)) days.push(day);
  return days;
}

/**
 * The binding end for a cancellation that reached us on `requestDay` (Berlin). `lateFrom` is set when the notice missed the
 * current billing month's end: the day by which it would have had to arrive (`cutoff`) and the end it missed (`missedEnd`).
 */
export function noticeEnd(input: { requestDay: string; anchorDay: number; lastFreeDay: string | null }) {
  const notice = addDays(input.requestDay, MIN_NOTICE_DAYS);
  if (input.lastFreeDay && input.requestDay <= input.lastFreeDay) {
    return { endDate: notice > input.lastFreeDay ? notice : input.lastFreeDay, freeMonth: true as const, late: null };
  }
  const endDate = nextBillingMonthEnd(notice, input.anchorDay);
  const current = nextBillingMonthEnd(input.requestDay, input.anchorDay);
  return { endDate, freeMonth: false as const, late: endDate > current ? { missedEnd: current, cutoff: addDays(current, -MIN_NOTICE_DAYS) } : null };
}

type Invoice = { date: string; from: string; to: string; amountMinor: number };
export type ContractFacts = {
  lastDay: string;
  exportUntil: string;
  /** free: no invoice at all (free month); none: no further invoice, `previous` is the last one; due: these are still drawn. */
  invoice: { kind: "free" } | { kind: "none"; previous: Invoice | null } | { kind: "due"; invoices: Invoice[] };
  freeMonth: boolean;
  lastFreeDay: string | null;
  locations: string[];
  anchorDay: number;
};

/** The shop's billing anchor, its free month and its monthly total: the inputs of every date and fact above. */
export async function contractBasis(tenantId: string) {
  const [shop] = await db.select({ created: tenants.createdAt, sub: subscriptions }).from(tenants).leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id)).where(eq(tenants.id, tenantId));
  if (!shop) return null;
  const sub = shop.sub;
  // Before billing exists, the go-live day stands in for the billing day (CTO): the shop's own start.
  const anchor = sub?.freeUntil ?? sub?.currentPeriodEnd ?? sub?.startedAt ?? shop.created;
  const lastFreeDay = sub?.freeUntil ? berlinDay(new Date(sub.freeUntil.getTime() - 86_400_000)) : null;
  const names = (await db.select({ name: locations.name }).from(locations).innerJoin(programs, eq(programs.locationId, locations.id))
    .where(eq(locations.tenantId, tenantId)).orderBy(locations.name)).map(row => row.name);
  const billed = !!sub && (sub.freeUntil !== null || sub.providerSubscriptionId !== null);
  return { anchorDay: Number(berlinDay(anchor).slice(8)), lastFreeDay, firstBillingDay: sub?.freeUntil ? berlinDay(sub.freeUntil) : null,
    totalMinor: sub ? planCharge(sub)?.totalMinor ?? null : null, billed, locations: [...new Set(names)] };
}

/** The three facts for an end on `endDate`, as the owner page, the operator preview and the emails show them. */
export async function contractFacts(tenantId: string, endDate: string, now = new Date(), requestDay?: string): Promise<ContractFacts | null> {
  const basis = await contractBasis(tenantId);
  if (!basis) return null;
  const today = berlinDay(now);
  const request = requestDay ?? today;
  const exportUntil = addDays(endDate, EXPORT_DAYS_AFTER_END);
  const common = { lastDay: endDate, exportUntil, locations: basis.locations, anchorDay: basis.anchorDay, lastFreeDay: basis.lastFreeDay };
  // A cancellation from the free month is never charged, up to its notice end (Legal, 1 Nov).
  const free = basis.lastFreeDay && request <= basis.lastFreeDay ? noticeEnd({ requestDay: request, anchorDay: basis.anchorDay, lastFreeDay: basis.lastFreeDay }).endDate : null;
  if (!basis.billed || (free && endDate <= free)) return { ...common, invoice: basis.billed ? { kind: "free" } : { kind: "none", previous: null }, freeMonth: !!free };
  const amountMinor = basis.totalMinor ?? 0;
  const invoice = (date: string): Invoice => ({ date, from: date, to: addDays(nextBillingDay(date, basis.anchorDay), -1), amountMinor });
  const due = billingDaysBetween(today, endDate, basis.anchorDay).filter(day => !basis.firstBillingDay || day >= basis.firstBillingDay);
  if (due.length) return { ...common, invoice: { kind: "due", invoices: due.map(invoice) }, freeMonth: false };
  // The last invoice drawn so far: the latest billing day on or before today, from the first billing day on.
  let previous: string | null = null;
  for (let day = today; basis.firstBillingDay ? day >= basis.firstBillingDay : day > addDays(today, -32); day = addDays(day, -1)) {
    if (day === billingDayIn(day, basis.anchorDay)) { previous = day; break; }
  }
  return { ...common, invoice: { kind: "none", previous: previous ? invoice(previous) : null }, freeMonth: false };
}

export function nextBillingDay(isoDay: string, anchorDay: number) {
  let day = addDays(isoDay, 1);
  while (day !== billingDayIn(day, anchorDay)) day = addDays(day, 1);
  return day;
}

/** The ends the operator may offer after the binding one, each with the invoices it adds (only with the shop's consent). */
export function laterEnds(binding: string, anchorDay: number, count = 3) {
  const ends: string[] = [];
  let day = binding;
  while (ends.length < count) { day = nextBillingMonthEnd(addDays(day, 1), anchorDay); ends.push(day); }
  return ends;
}

const euros = (minor: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
const day = (iso: string) => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const shortDay = (iso: string) => day(iso).slice(0, 6);
/** „28.10.–27.11.2026“, or both years when the period crosses one. */
const period = (from: string, to: string) => `${from.slice(0, 4) === to.slice(0, 4) ? shortDay(from) : day(from)}–${day(to)}`;
/** „28.11. und 28.12.2026“, „28.11., 28.12.2026 und 28.01.2027“: the year once per run of the same year. */
function dayList(days: string[]) {
  const parts = days.map((iso, i) => days[i + 1]?.slice(0, 4) === iso.slice(0, 4) ? shortDay(iso) : day(iso));
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} und ${parts.at(-1)}`;
}

/**
 * The three facts in Marketing's and Legal's words (ENG-167 strings C1–C8, C38), for every screen and email alike.
 * Amounts are the shop's monthly total as invoiced; in standard VAT mode „zzgl. USt“ follows, as on the invoice.
 * The deletion sentence names the DS-05 period only once the founder has set SHOP_ERASURE_DELAY_DAYS.
 */
export function factsLines(facts: ContractFacts, vat: "none" | "kleinunternehmer" | "standard", env: Record<string, string | undefined> = process.env) {
  const amount = (minor: number) => `${euros(minor)}${vat === "standard" ? " zzgl. USt" : ""}`;
  const count = facts.locations.length;
  const withCount = (minor: number) => count > 1 ? `${amount(minor)} (${count} Standorte)` : amount(minor);
  const invoice = facts.invoice;
  const last = invoice.kind === "free" ? { value: "Keine Rechnung", sub: facts.freeMonth && facts.lastDay > lastFreeOf(facts) ? `Dein erster Monat ist kostenlos, die Tage danach bis einschließlich ${day(facts.lastDay)} auch.` : "Dein erster Monat ist kostenlos. Hörst du im ersten Monat auf, kostet es nichts." }
    : invoice.kind === "none" ? { value: "Keine weitere Rechnung", sub: invoice.previous ? `Die letzte kam am ${day(invoice.previous.date)}: ${withCount(invoice.previous.amountMinor)} für ${period(invoice.previous.from, invoice.previous.to)}.` : "" }
      // C2/C5/C6 show the plain total; only C4 (the last one already came) names the location count.
      : invoice.invoices.length === 1 ? { value: `${day(invoice.invoices[0].date)} · ${amount(invoice.invoices[0].amountMinor)}`, sub: `Für ${period(invoice.invoices[0].from, invoice.invoices[0].to)}. Das ist die letzte Rechnung.` }
        : { value: `${day(invoice.invoices.at(-1)!.date)} · ${amount(invoice.invoices.at(-1)!.amountMinor)}`, sub: `Noch ${invoice.invoices.length} Rechnungen: ${dayList(invoice.invoices.map(i => i.date))}, je ${amount(invoice.invoices[0].amountMinor)}. Die am ${shortDay(invoice.invoices.at(-1)!.date)} ist die letzte.` };
  const ds05 = env.SHOP_ERASURE_DELAY_DAYS && /^\d{1,4}$/.test(env.SHOP_ERASURE_DELAY_DAYS) && Number(env.SHOP_ERASURE_DELAY_DAYS) >= 7 ? ` innerhalb von ${Number(env.SHOP_ERASURE_DELAY_DAYS)} Tagen` : "";
  return {
    lastDay: { label: "Letzter Tag", value: day(facts.lastDay), sub: "Bis dahin läuft alles normal: Deine Kunden sammeln weiter und lösen Prämien ein." },
    lastInvoice: { label: "Letzte Rechnung", ...last },
    exportUntil: { label: "Daten herunterladen bis", value: day(facts.exportUntil), sub: `Danach löschen wir${ds05} alle Daten deines Geschäfts und deiner Kunden. Rechnungen und Vertragsunterlagen bewahren wir auf, solange das Gesetz es verlangt.` },
  };
}
// The last free day travels with the facts so the free-month line can tell the free month from the days after it.
const lastFreeOf = (facts: ContractFacts) => facts.lastFreeDay ?? facts.lastDay;

/** „Text für deine Kunden“ (live since #84): the owner hangs it at the till; we never write to customers. */
export const customerText = (unit: "Stempel" | "Punkte", endDate: string) =>
  `Unsere ${unit}karte läuft noch bis einschließlich ${day(endDate)}. Bis dahin kannst du weiter sammeln und Prämien einlösen. Danach geht das nicht mehr.`;

/**
 * What happens to billing when a cancellation is withdrawn (C17/C18; M3 and the withdrawal question say the same): the next
 * invoice, or in the free month the first billing day. Null before billing exists.
 */
export function withdrawalBillingLine(basis: NonNullable<Awaited<ReturnType<typeof contractBasis>>>, today: string) {
  if (basis.totalMinor === null || !basis.billed) return null;
  if (basis.lastFreeDay && today <= basis.lastFreeDay && basis.firstBillingDay) return `Nach dem kostenlosen Monat beginnt die Abrechnung am ${day(basis.firstBillingDay)}, ${euros(basis.totalMinor)} im Monat.`;
  return `Die Abrechnung bleibt wie bisher: nächste Rechnung am ${day(nextBillingDay(today, basis.anchorDay))}, ${euros(basis.totalMinor)}.`;
}
