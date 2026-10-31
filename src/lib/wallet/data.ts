import { createHash } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { ledgerEntries, locations, memberships, programs, tenants, walletMessageConsents, walletMessageRecipients, walletMessages } from "@/db/schema";
import { signUpRules } from "@/lib/card-extras";
import { changeLines, waitingLines } from "@/lib/change-lines";
import { formatCardLocator } from "@/lib/card-locator";
import { DomainError } from "@/lib/loyalty";
import { currentRewards, publicRules } from "@/lib/product";
import { programInForce } from "@/lib/rule-versions";
import type { WalletBrand, WalletPassData } from "./types";
import { appleLogoFromData, merchantGoogleLogoUrl } from "./logo";

/**
 * Binds an issued pass to the card credential it was issued for. A staff reissue or closure replaces the scan code, so
 * every pass issued before it stops matching and is revoked instead of refreshed.
 */
export function credentialHash(scanCode: string): string {
  return createHash("sha256").update("loynara-wallet-credential-v1\0").update(scanCode).digest("hex");
}

export type WalletCardSnapshot =
  | { open: true; credentialHash: string; pass: WalletPassData }
  | { open: false; brand: WalletBrand & { membershipId: string } };

/**
 * The single read path for every Wallet build and refresh: the membership row, its programme, location and merchant,
 * the target reward and the latest ledger time. A closed card yields only its branding, never balance or codes.
 */
export async function walletCardSnapshot(membershipId: string, reader: Pick<typeof db, "select"> = db): Promise<WalletCardSnapshot> {
  const [row] = await reader.select({ member: memberships, program: programs, location: locations, tenant: tenants })
    .from(memberships)
    .innerJoin(programs, and(eq(programs.id, memberships.programId), eq(programs.tenantId, memberships.tenantId)))
    .innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(memberships.id, membershipId));
  if (!row) throw new DomainError("NOT_FOUND", "Diese Karte haben wir nicht gefunden.");
  const program = await programInForce(reader, row.program);
  const appleLogo = await appleLogoFromData(row.location.logoData, row.location.brandColor);
  const googleLogoUrl = merchantGoogleLogoUrl(row.program.id, row.location.logoData);
  const brand: WalletBrand & { membershipId: string } = {
    programType: program.type === "points" ? "points" : "stamp",
    tenantId: row.tenant.id,
    locationId: row.location.id,
    membershipId: row.member.id,
    programId: row.program.id,
    merchantName: row.tenant.name,
    programName: program.name,
    locationName: row.location.name,
    brandColor: row.location.brandColor,
    country: row.location.country,
    locale: row.tenant.locale === "fr" ? "fr" : "de",
    ...(appleLogo ? { appleLogo } : {}),
    ...(googleLogoUrl ? { googleLogoUrl } : {}),
    ...(row.location.latitude !== null && row.location.longitude !== null ? { latitude: row.location.latitude, longitude: row.location.longitude } : {}),
  };
  if (row.member.closedAt) return { open: false, brand };
  const rewardList = await currentRewards(row.member.tenantId, row.program.id, reader);
  const [target] = rewardList;
  const [latest] = await reader.select({ createdAt: ledgerEntries.createdAt }).from(ledgerEntries)
    .where(and(eq(ledgerEntries.tenantId, row.member.tenantId), eq(ledgerEntries.membershipId, row.member.id)))
    .orderBy(desc(ledgerEntries.createdAt)).limit(1);
  const [lastMessage] = await reader.select({ text: walletMessages.text, sentAt: walletMessages.createdAt }).from(walletMessageRecipients)
    .innerJoin(walletMessages, and(eq(walletMessages.id, walletMessageRecipients.messageId), eq(walletMessages.tenantId, walletMessageRecipients.tenantId)))
    // Every row that may have reached the device, so a refresh never puts an older text back (with a banner):
    // sent, in flight, queued for a retry after a try that may have been applied, or failed with an unknown outcome.
    .where(and(eq(walletMessageRecipients.tenantId, row.member.tenantId), eq(walletMessageRecipients.membershipId, row.member.id),
      sql`(${walletMessageRecipients.status} in ('sent','sending') or (${walletMessageRecipients.status} = 'queued' and ${walletMessageRecipients.attempts} > 0) or (${walletMessageRecipients.status} = 'failed' and ${walletMessageRecipients.reason} = 'uncertain'))`))
    .orderBy(desc(walletMessages.createdAt)).limit(1);
  // A card that allowed messages carries the (empty) field before the first one, because Wallet alerts only when an existing key changes.
  const [consent] = lastMessage ? [] : await reader.select({ id: walletMessageConsents.id }).from(walletMessageConsents)
    .where(and(eq(walletMessageConsents.tenantId, row.member.tenantId), eq(walletMessageConsents.membershipId, row.member.id), isNull(walletMessageConsents.withdrawnAt))).limit(1);
  return {
    open: true,
    credentialHash: credentialHash(row.member.scanCode),
    pass: {
      ...brand,
      programType: program.type === "points" ? "points" : "stamp",
      balance: row.member.balance,
      scanCode: row.member.scanCode,
      cardLocator: formatCardLocator(row.member.cardLocator),
      ...(target ? { reward: { title: target.title, cost: target.cost, pending: target.pending, endsOn: target.endsOn } } : {}),
      rewards: rewardList.map(({ title, cost }) => ({ title, cost })),
      // ENG-100: the dated lines come first, the whole new rule quoted (W46, W58), then the rules in force.
      rules: [...waitingLines(changeLines({ programType: program.type === "points" ? "points" : "stamp", rewards: rewardList, pending: program.pending, pendingExpiry: program.pendingExpiry }, true)), ...signUpRules(publicRules(program, row.tenant))],
      ...(latest ? { lastActivityAt: latest.createdAt } : {}),
      // The send day in the shop's timezone („28.10.“): the back keeps a message until the next one (Marketing, ENG-127).
      ...(lastMessage ? { message: lastMessage.text, messageDay: new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", timeZone: row.location.timezone }).format(lastMessage.sentAt) } : consent ? { message: "" } : {}),
      pending: program.pending, pendingExpiry: program.pendingExpiry,
    },
  };
}

/** The open card's pass data; a closed or unknown card is NOT_FOUND. */
export async function walletPassDataByMembershipId(membershipId: string): Promise<WalletPassData> {
  const snapshot = await walletCardSnapshot(membershipId);
  if (!snapshot.open) throw new DomainError("NOT_FOUND", "Diese Karte haben wir nicht gefunden.");
  return snapshot.pass;
}
