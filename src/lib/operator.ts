import { and, asc, desc, eq, isNotNull, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { billingLocationPlans, ledgerEntries, locations, memberships, programs, secureTags, subscriptions, tenants } from "@/db/schema";
import { assertPlateOperator } from "./plates";
import { walletMessageStats } from "./wallet-messages";

/**
 * The operator's read model: shops and plates, counts and dates only. No customer, card or contact data is selected,
 * so none can reach the page. Every read runs the same operator check as the plate writes.
 */
export async function operatorOverview(actorUserId: string, env: Record<string, string | undefined> = process.env) {
  return db.transaction(async tx => {
    await assertPlateOperator(tx, actorUserId, env);
    const cards = tx.select({ programId: memberships.programId, cards: sql<number>`count(*)::int`.as("cards") }).from(memberships).groupBy(memberships.programId).as("c");
    // shortcut: aggregates the whole ledger per programme on every page load, fine at pilot size; add a cached or indexed last-award column when shops exceed a few hundred.
    const awards = tx.select({ programId: memberships.programId, last: max(ledgerEntries.createdAt).as("last") }).from(ledgerEntries)
      .innerJoin(memberships, and(eq(memberships.id, ledgerEntries.membershipId), eq(memberships.tenantId, ledgerEntries.tenantId)))
      .where(and(eq(ledgerEntries.kind, "award"), sql`${ledgerEntries.source} in ('staff_online','staff_offline','nfc_tap')`))
      .groupBy(memberships.programId).as("a");
    const rows = await tx.select({
      tenantId: tenants.id, tenant: tenants.name, weeklyReport: tenants.weeklyReportEnabled,
      locationId: locations.id, location: locations.name, city: locations.city,
      programId: programs.id, programme: programs.name, status: programs.status, tapMode: programs.tapMode,
      endDate: programs.cancellationEndDate, requestedAt: programs.cancellationRequestedAt, confirmedAt: programs.cancellationConfirmedAt,
      cards: sql<number>`coalesce(${cards.cards}, 0)`, lastAward: awards.last,
    }).from(programs)
      .innerJoin(tenants, eq(tenants.id, programs.tenantId))
      .innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
      .leftJoin(cards, eq(cards.programId, programs.id)).leftJoin(awards, eq(awards.programId, programs.id))
      .orderBy(asc(tenants.name), asc(locations.name), asc(programs.name));
    const plates = await tx.select({
      plateLabel: secureTags.plateLabel, status: secureTags.status, everTapped: sql<boolean>`${secureTags.lastCounter} > 0`,
      programId: secureTags.programId, merchant: tenants.name, location: locations.name, programme: programs.name,
    }).from(secureTags)
      .leftJoin(programs, eq(programs.id, secureTags.programId)).leftJoin(tenants, eq(tenants.id, secureTags.tenantId))
      .leftJoin(locations, eq(locations.id, secureTags.locationId))
      .where(isNotNull(secureTags.plateLabel)).orderBy(asc(secureTags.plateLabel));
    // Age is computed here so the page renders the same on server and client.
    const now = Date.now();
    const messages = await walletMessageStats(tx);
    // Billing per shop (the plan the operator chose, the Stripe state) and every start-guarantee decision per location (the operator's notice).
    const billing = await tx.select({ tenantId: tenants.id, tenant: tenants.name, status: subscriptions.status, planCode: subscriptions.planCode, currency: subscriptions.currency })
      .from(subscriptions).innerJoin(tenants, eq(tenants.id, subscriptions.tenantId)).orderBy(asc(tenants.name));
    const guarantees = await tx.select({ locationId: billingLocationPlans.locationId, tenant: tenants.name, location: locations.name, customers: billingLocationPlans.guaranteeCustomers,
      outcome: billingLocationPlans.guaranteeOutcome, credited: sql<boolean>`${billingLocationPlans.guaranteeCreditRef} is not null`, decidedAt: billingLocationPlans.guaranteeDecidedAt })
      .from(billingLocationPlans).innerJoin(tenants, eq(tenants.id, billingLocationPlans.tenantId))
      .innerJoin(locations, and(eq(locations.id, billingLocationPlans.locationId), eq(locations.tenantId, billingLocationPlans.tenantId)))
      .where(isNotNull(billingLocationPlans.guaranteeOutcome)).orderBy(desc(billingLocationPlans.guaranteeDecidedAt));
    return { billing, guarantees, rows: rows.map(({ requestedAt, confirmedAt, ...row }) => ({ ...row, walletMessages: messages.get(row.programId) ?? null, confirmed: confirmedAt !== null, requestedDays: requestedAt ? Math.floor((now - requestedAt.getTime()) / 86_400_000) : null })), plates };
  });
}
