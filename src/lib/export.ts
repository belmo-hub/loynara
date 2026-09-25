import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { billingInvoices, billingLocationPlans, consentEvents, ledgerEntries, locations, memberships, programs, redemptions, rewardVersions, rewards, staffRoles, subscriptions, tenants } from "@/db/schema";
import { DomainError } from "./loyalty";
import { validCardToken } from "./card-lifecycle";

const MAX_ROWS = 50_000;
function checked<T>(rows: T[], label: string) {
  if (rows.length > MAX_ROWS) throw new DomainError("EXPORT_TOO_LARGE", `${label} exceeds the single-file export limit`);
  return rows;
}

export async function getMerchantExport(actorUserId: string) {
  const [owner] = await db.select().from(staffRoles).where(and(eq(staffRoles.userId, actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))).limit(1);
  if (!owner) throw new DomainError("FORBIDDEN", "Owner access required");
  const tenantId = owner.tenantId;
  const [[tenant], [subscription], locationRows, programRows, rewardRows, versionRows, membershipRows, ledgerRows, redemptionRows, consentRows, roleRows, planRows, invoiceRows] = await Promise.all([
    db.select().from(tenants).where(eq(tenants.id, tenantId)),
    db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)),
    db.select({ id: locations.id, name: locations.name, city: locations.city, country: locations.country, timezone: locations.timezone, brandColor: locations.brandColor, latitude: locations.latitude, longitude: locations.longitude, createdAt: locations.createdAt }).from(locations).where(eq(locations.tenantId, tenantId)).limit(MAX_ROWS + 1),
    db.select().from(programs).where(eq(programs.tenantId, tenantId)).limit(MAX_ROWS + 1),
    db.select().from(rewards).where(eq(rewards.tenantId, tenantId)).limit(MAX_ROWS + 1),
    db.select().from(rewardVersions).where(eq(rewardVersions.tenantId, tenantId)).limit(MAX_ROWS + 1),
    db.select({ id: memberships.id, programId: memberships.programId, balance: memberships.balance, createdAt: memberships.createdAt, closedAt: memberships.closedAt }).from(memberships).where(eq(memberships.tenantId, tenantId)).limit(MAX_ROWS + 1),
    db.select().from(ledgerEntries).where(eq(ledgerEntries.tenantId, tenantId)).limit(MAX_ROWS + 1),
    db.select().from(redemptions).where(eq(redemptions.tenantId, tenantId)).limit(MAX_ROWS + 1),
    db.select().from(consentEvents).where(eq(consentEvents.tenantId, tenantId)).limit(MAX_ROWS + 1),
    db.select({ userId: staffRoles.userId, role: staffRoles.role, locationId: staffRoles.locationId, active: staffRoles.active, createdAt: staffRoles.createdAt }).from(staffRoles).where(eq(staffRoles.tenantId, tenantId)).limit(MAX_ROWS + 1),
    db.select().from(billingLocationPlans).where(eq(billingLocationPlans.tenantId, tenantId)).limit(MAX_ROWS + 1),
    db.select().from(billingInvoices).where(eq(billingInvoices.tenantId, tenantId)).limit(MAX_ROWS + 1),
  ]);
  if (!tenant) throw new DomainError("NOT_FOUND", "Merchant not found");
  return {
    formatVersion: 2,
    exportedAt: new Date().toISOString(),
    scope: "owner-business-data-without-card-or-contact-credentials",
    tenant,
    subscription,
    locations: checked(locationRows, "Locations"),
    programs: checked(programRows, "Programs"),
    rewards: checked(rewardRows, "Rewards"),
    rewardVersions: checked(versionRows, "Reward versions"),
    memberships: checked(membershipRows, "Memberships"),
    ledger: checked(ledgerRows, "Ledger"),
    redemptions: checked(redemptionRows, "Redemptions"),
    consentEvents: checked(consentRows, "Consent events"),
    staff: checked(roleRows, "Staff roles"),
    billingLocationPlans: checked(planRows, "Billing location plans"),
    billingInvoices: checked(invoiceRows, "Billing fixture invoices"),
  };
}

export async function getCustomerExport(cardToken: string) {
  if (!validCardToken(cardToken)) throw new DomainError("NOT_FOUND", "Card not found");
  const [card] = await db.select({ id: memberships.id, tenantId: memberships.tenantId, programId: memberships.programId, balance: memberships.balance, createdAt: memberships.createdAt }).from(memberships).where(and(eq(memberships.cardToken, cardToken), isNull(memberships.closedAt)));
  if (!card) throw new DomainError("NOT_FOUND", "Card not found");
  const [[program], entries, redemptionRows, consentRows] = await Promise.all([
    db.select({ name: programs.name, type: programs.type, rulesText: programs.rulesText }).from(programs).where(and(eq(programs.id, card.programId), eq(programs.tenantId, card.tenantId))),
    db.select({ id: ledgerEntries.id, delta: ledgerEntries.delta, kind: ledgerEntries.kind, reason: ledgerEntries.reason, reversalOfId: ledgerEntries.reversalOfId, createdAt: ledgerEntries.createdAt }).from(ledgerEntries).where(and(eq(ledgerEntries.tenantId, card.tenantId), eq(ledgerEntries.membershipId, card.id))).limit(MAX_ROWS + 1),
    db.select({ rewardTitle: redemptions.rewardTitle, cost: redemptions.cost, createdAt: redemptions.createdAt }).from(redemptions).where(and(eq(redemptions.tenantId, card.tenantId), eq(redemptions.membershipId, card.id))).limit(MAX_ROWS + 1),
    db.select({ channel: consentEvents.channel, purpose: consentEvents.purpose, granted: consentEvents.granted, noticeVersion: consentEvents.noticeVersion, source: consentEvents.source, createdAt: consentEvents.createdAt }).from(consentEvents).where(and(eq(consentEvents.tenantId, card.tenantId), eq(consentEvents.membershipId, card.id))).limit(MAX_ROWS + 1),
  ]);
  return { formatVersion: 1, exportedAt: new Date().toISOString(), scope: "pseudonymous-card-activity-without-contact-records", membership: { id: card.id, balance: card.balance, createdAt: card.createdAt }, program, ledger: checked(entries, "Card ledger"), redemptions: checked(redemptionRows, "Card redemptions"), consentEvents: checked(consentRows, "Card consent events") };
}
