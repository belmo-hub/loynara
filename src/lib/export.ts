import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { billingInvoices, billingLocationPlans, cardSecurityEvents, consentEvents, ledgerEntries, locations, memberships, programs, redemptions, rewardVersions, rewards, staffAuditEvents, staffRoles, subscriptions, tenants } from "@/db/schema";
import { DomainError } from "./loyalty";
import { validCardToken } from "./card-lifecycle";
import { formatCardLocator } from "./card-locator";
import { assertExportOpen } from "./programme-end";

const MAX_ROWS = 50_000;
function checked<T>(rows: T[], label: string) {
  if (rows.length > MAX_ROWS) throw new DomainError("EXPORT_TOO_LARGE", `${label} exceeds the single-file export limit`);
  return rows;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function ownerTenantId(tx: Tx, actorUserId: string) {
  const [owner] = await tx.select().from(staffRoles).where(and(eq(staffRoles.userId, actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))).limit(1);
  if (!owner) throw new DomainError("FORBIDDEN", "Owner access required");
  return owner.tenantId;
}

export async function getMerchantExport(actorUserId: string) {
  // Owner authorization and every exported category share one committed snapshot.
  return db.transaction(async (tx) => {
    const tenantId = await ownerTenantId(tx, actorUserId);
    await assertExportOpen(tx, tenantId);
    const [[tenant], [subscription], locationRows, programRows, rewardRows, versionRows, membershipRows, ledgerRows, redemptionRows, consentRows, roleRows, auditRows, planRows, invoiceRows, securityRows] = await Promise.all([
      tx.select().from(tenants).where(eq(tenants.id, tenantId)),
      tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)),
      tx.select({ id: locations.id, name: locations.name, city: locations.city, country: locations.country, timezone: locations.timezone, brandColor: locations.brandColor, latitude: locations.latitude, longitude: locations.longitude, createdAt: locations.createdAt }).from(locations).where(eq(locations.tenantId, tenantId)).limit(MAX_ROWS + 1),
      tx.select().from(programs).where(eq(programs.tenantId, tenantId)).limit(MAX_ROWS + 1),
      tx.select().from(rewards).where(eq(rewards.tenantId, tenantId)).limit(MAX_ROWS + 1),
      tx.select().from(rewardVersions).where(eq(rewardVersions.tenantId, tenantId)).limit(MAX_ROWS + 1),
      tx.select({ id: memberships.id, cardLocator: memberships.cardLocator, programId: memberships.programId, balance: memberships.balance, createdAt: memberships.createdAt, closedAt: memberships.closedAt }).from(memberships).where(eq(memberships.tenantId, tenantId)).limit(MAX_ROWS + 1),
      tx.select().from(ledgerEntries).where(eq(ledgerEntries.tenantId, tenantId)).limit(MAX_ROWS + 1),
      tx.select().from(redemptions).where(eq(redemptions.tenantId, tenantId)).limit(MAX_ROWS + 1),
      tx.select().from(consentEvents).where(eq(consentEvents.tenantId, tenantId)).limit(MAX_ROWS + 1),
      tx.select({ userId: staffRoles.userId, role: staffRoles.role, locationId: staffRoles.locationId, active: staffRoles.active, createdAt: staffRoles.createdAt }).from(staffRoles).where(eq(staffRoles.tenantId, tenantId)).limit(MAX_ROWS + 1),
      tx.select().from(staffAuditEvents).where(eq(staffAuditEvents.tenantId, tenantId)).orderBy(desc(staffAuditEvents.createdAt), desc(staffAuditEvents.id)).limit(MAX_ROWS + 1),
      tx.select().from(billingLocationPlans).where(eq(billingLocationPlans.tenantId, tenantId)).limit(MAX_ROWS + 1),
      tx.select().from(billingInvoices).where(eq(billingInvoices.tenantId, tenantId)).limit(MAX_ROWS + 1),
      tx.select().from(cardSecurityEvents).where(eq(cardSecurityEvents.tenantId, tenantId)).orderBy(desc(cardSecurityEvents.createdAt)).limit(MAX_ROWS + 1),
    ]);
    if (!tenant) throw new DomainError("NOT_FOUND", "Merchant not found");
    return {
      // 4: card locators on memberships; card security events (reissues with actor, reason and verification method).
      formatVersion: 4,
      exportedAt: new Date().toISOString(),
      scope: "owner-business-data-without-card-or-contact-credentials",
      tenant,
      subscription,
      locations: checked(locationRows, "Locations"),
      programs: checked(programRows, "Programs"),
      rewards: checked(rewardRows, "Rewards"),
      rewardVersions: checked(versionRows, "Reward versions"),
      memberships: checked(membershipRows, "Memberships").map(row => ({ ...row, cardLocator: formatCardLocator(row.cardLocator) })),
      ledger: checked(ledgerRows, "Ledger"),
      redemptions: checked(redemptionRows, "Redemptions"),
      consentEvents: checked(consentRows, "Consent events"),
      staff: checked(roleRows, "Staff roles"),
      staffAuditEvents: checked(auditRows, "Staff audit events"),
      billingLocationPlans: checked(planRows, "Billing location plans"),
      billingInvoices: checked(invoiceRows, "Billing fixture invoices"),
      cardSecurityEvents: checked(securityRows, "Card security events"),
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

// ENG-004: Excel-ready CSV for German shop owners (UTF-8 with BOM, semicolons, German dates in Europe/Berlin).
export type MerchantCsvKind = "karten" | "buchungen";
const berlinDate = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
const berlinTime = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const berlinIsoDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" });
const day = (at: Date | null) => at ? berlinDate.format(at) : "";

/** A text cell. A leading = + - @, tab or carriage return (OWASP) gets an apostrophe so Excel never runs it as a formula; quotes wrap separators. */
export function csvText(value: string | null | undefined) {
  const text = value ?? "";
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[";\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
const csv = (header: string[], rows: string[][]) => "﻿" + [header, ...rows].map(row => row.join(";")).join("\r\n") + "\r\n";

/** Vorgang wording from Product's ENG-004 note (18 Oct). */
export function ledgerVorgang(kind: string, source: string, programType: string) {
  const unit = programType === "points" ? "Punkte" : "Stempel";
  if (source === "synthetic_seed" || source === "legacy_unclassified") return "Sonstige Buchung";
  if (kind === "redeem") return "Prämie eingelöst";
  if (kind === "reversal") return "Korrektur";
  if (source === "staff_online") return unit;
  if (source === "staff_offline") return `${unit} (offline)`;
  if (source === "nfc_tap") return `${unit} (NFC automatisch)`;
  if (source === "referral_bonus") return "Empfehlungsbonus";
  return "Sonstige Buchung";
}

/** Owner-only CSV of the owner's own tenant: card numbers (locators) only, never card tokens, scan codes or contact data. */
export async function getMerchantCsv(actorUserId: string, kind: MerchantCsvKind) {
  return db.transaction(async (tx) => {
    const tenantId = await ownerTenantId(tx, actorUserId);
    await assertExportOpen(tx, tenantId);
    const filename = `loynara-${kind}-${berlinIsoDate.format(new Date())}.csv`;
    if (kind === "karten") {
      const rows = checked(await tx.select({ cardLocator: memberships.cardLocator, program: programs.name, balance: memberships.balance, createdAt: memberships.createdAt, closedAt: memberships.closedAt })
        .from(memberships).innerJoin(programs, and(eq(programs.tenantId, memberships.tenantId), eq(programs.id, memberships.programId)))
        .where(eq(memberships.tenantId, tenantId)).orderBy(asc(memberships.createdAt), asc(memberships.id)).limit(MAX_ROWS + 1), "Memberships");
      return { filename, body: csv(["Kartennummer", "Programm", "Aktueller Stand", "Ausgestellt am", "Geschlossen am"], rows.map(row => [csvText(formatCardLocator(row.cardLocator)), csvText(row.program), String(row.balance), day(row.createdAt), day(row.closedAt)])) };
    }
    const [rows, staff] = await Promise.all([
      tx.select({ createdAt: ledgerEntries.createdAt, cardLocator: memberships.cardLocator, location: locations.name, kind: ledgerEntries.kind, source: ledgerEntries.source, programType: programs.type, delta: ledgerEntries.delta, reason: ledgerEntries.reason, actorUserId: ledgerEntries.actorUserId })
        .from(ledgerEntries)
        .innerJoin(memberships, and(eq(memberships.tenantId, ledgerEntries.tenantId), eq(memberships.id, ledgerEntries.membershipId)))
        .innerJoin(programs, and(eq(programs.tenantId, memberships.tenantId), eq(programs.id, memberships.programId)))
        .innerJoin(locations, and(eq(locations.tenantId, ledgerEntries.tenantId), eq(locations.id, ledgerEntries.locationId)))
        .where(eq(ledgerEntries.tenantId, tenantId)).orderBy(asc(ledgerEntries.createdAt), asc(ledgerEntries.id)).limit(MAX_ROWS + 1),
      // Name only, never email, and only for people with a role in this tenant; anyone else reads "unbekannt".
      tx.execute<{ id: string; name: string }>(sql`SELECT u.id, u.name FROM "user" u JOIN staff_roles r ON r.user_id = u.id WHERE r.tenant_id = ${tenantId}`),
    ]);
    const names = new Map(staff.rows.map(row => [row.id, row.name.trim()]));
    return { filename, body: csv(["Datum", "Uhrzeit", "Kartennummer", "Standort", "Vorgang", "Menge", "Grund", "Bestätigt von"], checked(rows, "Ledger").map(row => [
      day(row.createdAt), berlinTime.format(row.createdAt), csvText(formatCardLocator(row.cardLocator)), csvText(row.location), ledgerVorgang(row.kind, row.source, row.programType), String(row.delta), csvText(row.reason),
      csvText(row.source === "nfc_tap" ? "NFC automatisch" : (row.actorUserId && names.get(row.actorUserId)) || "unbekannt"),
    ])) };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function getCustomerExport(cardToken: string) {
  if (!validCardToken(cardToken)) throw new DomainError("NOT_FOUND", "Card not found");
  // Membership balance and exported activity must come from one committed
  // snapshot, including when an award/redeem completes between these reads.
  return db.transaction(async (tx) => {
    const [card] = await tx.select({ id: memberships.id, cardLocator: memberships.cardLocator, tenantId: memberships.tenantId, programId: memberships.programId, balance: memberships.balance, createdAt: memberships.createdAt }).from(memberships).where(and(eq(memberships.cardToken, cardToken), isNull(memberships.closedAt)));
    if (!card) throw new DomainError("NOT_FOUND", "Card not found");
    const [[program], entries, redemptionRows, consentRows] = await Promise.all([
      tx.select({ name: programs.name, type: programs.type, rulesText: programs.rulesText }).from(programs).where(and(eq(programs.id, card.programId), eq(programs.tenantId, card.tenantId))),
      tx.select({ id: ledgerEntries.id, delta: ledgerEntries.delta, kind: ledgerEntries.kind, reason: ledgerEntries.reason, reversalOfId: ledgerEntries.reversalOfId, createdAt: ledgerEntries.createdAt }).from(ledgerEntries).where(and(eq(ledgerEntries.tenantId, card.tenantId), eq(ledgerEntries.membershipId, card.id))).limit(MAX_ROWS + 1),
      tx.select({ rewardTitle: redemptions.rewardTitle, cost: redemptions.cost, createdAt: redemptions.createdAt }).from(redemptions).where(and(eq(redemptions.tenantId, card.tenantId), eq(redemptions.membershipId, card.id))).limit(MAX_ROWS + 1),
      tx.select({ channel: consentEvents.channel, purpose: consentEvents.purpose, granted: consentEvents.granted, noticeVersion: consentEvents.noticeVersion, source: consentEvents.source, createdAt: consentEvents.createdAt }).from(consentEvents).where(and(eq(consentEvents.tenantId, card.tenantId), eq(consentEvents.membershipId, card.id))).limit(MAX_ROWS + 1),
    ]);
    return { formatVersion: 1, exportedAt: new Date().toISOString(), scope: "pseudonymous-card-activity-without-contact-records", membership: { id: card.id, cardLocator: formatCardLocator(card.cardLocator), balance: card.balance, createdAt: card.createdAt }, program, ledger: checked(entries, "Card ledger"), redemptions: checked(redemptionRows, "Card redemptions"), consentEvents: checked(consentRows, "Card consent events") };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
