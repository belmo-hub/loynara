import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { ledgerEntries, locations, memberships, programs, tenants } from "@/db/schema";
import { formatCardLocator } from "@/lib/card-locator";
import { DomainError } from "@/lib/loyalty";
import { currentRewards } from "@/lib/product";
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
  if (!row) throw new DomainError("NOT_FOUND", "Card not found");
  const appleLogo = appleLogoFromData(row.location.logoData);
  const googleLogoUrl = merchantGoogleLogoUrl(row.program.id, row.location.logoData);
  const brand: WalletBrand & { membershipId: string } = {
    tenantId: row.tenant.id,
    membershipId: row.member.id,
    programId: row.program.id,
    merchantName: row.tenant.name,
    programName: row.program.name,
    locationName: row.location.name,
    brandColor: row.location.brandColor,
    country: row.location.country,
    locale: row.tenant.locale === "fr" ? "fr" : "de",
    ...(appleLogo ? { appleLogo } : {}),
    ...(googleLogoUrl ? { googleLogoUrl } : {}),
    ...(row.location.latitude !== null && row.location.longitude !== null ? { latitude: row.location.latitude, longitude: row.location.longitude } : {}),
  };
  if (row.member.closedAt) return { open: false, brand };
  const [target] = await currentRewards(row.member.tenantId, row.program.id, reader);
  const [latest] = await reader.select({ createdAt: ledgerEntries.createdAt }).from(ledgerEntries)
    .where(and(eq(ledgerEntries.tenantId, row.member.tenantId), eq(ledgerEntries.membershipId, row.member.id)))
    .orderBy(desc(ledgerEntries.createdAt)).limit(1);
  return {
    open: true,
    credentialHash: credentialHash(row.member.scanCode),
    pass: {
      ...brand,
      programType: row.program.type === "points" ? "points" : "stamp",
      balance: row.member.balance,
      scanCode: row.member.scanCode,
      cardLocator: formatCardLocator(row.member.cardLocator),
      ...(target ? { reward: { title: target.title, cost: target.cost } } : {}),
      ...(latest ? { lastActivityAt: latest.createdAt } : {}),
    },
  };
}

/** The open card's pass data; a closed or unknown card is NOT_FOUND. */
export async function walletPassDataByMembershipId(membershipId: string): Promise<WalletPassData> {
  const snapshot = await walletCardSnapshot(membershipId);
  if (!snapshot.open) throw new DomainError("NOT_FOUND", "Card not found");
  return snapshot.pass;
}
