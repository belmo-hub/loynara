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
  const common = { lastDay: endDate, exportUntil, locations: basis.locations, anchorDay: basis.anchorDay };
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

function nextBillingDay(isoDay: string, anchorDay: number) {
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
