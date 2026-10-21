import { and, asc, eq, isNotNull, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { ledgerEntries, locations, memberships, programs, secureTags, tenants } from "@/db/schema";
import { assertPlateOperator } from "./plates";

/**
 * The operator's read model: shops and plates, counts and dates only. No customer, card or contact data is selected,
 * so none can reach the page. Every read runs the same operator check as the plate writes.
 */
export async function operatorOverview(actorUserId: string, env: Record<string, string | undefined> = process.env) {
  return db.transaction(async tx => {
    await assertPlateOperator(tx, actorUserId, env);
    const cards = tx.select({ programId: memberships.programId, cards: sql<number>`count(*)::int`.as("cards") }).from(memberships).groupBy(memberships.programId).as("c");
    const awards = tx.select({ programId: memberships.programId, last: max(ledgerEntries.createdAt).as("last") }).from(ledgerEntries)
      .innerJoin(memberships, and(eq(memberships.id, ledgerEntries.membershipId), eq(memberships.tenantId, ledgerEntries.tenantId)))
      .where(and(eq(ledgerEntries.kind, "award"), sql`${ledgerEntries.source} in ('staff_online','staff_offline','nfc_tap')`))
      .groupBy(memberships.programId).as("a");
    const rows = await tx.select({
      tenantId: tenants.id, tenant: tenants.name, weeklyReport: tenants.weeklyReportEnabled,
      locationId: locations.id, location: locations.name, city: locations.city,
      programId: programs.id, programme: programs.name, status: programs.status, tapMode: programs.tapMode,
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
    return { rows, plates };
  });
}
