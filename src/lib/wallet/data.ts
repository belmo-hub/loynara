import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { locations, memberships, programs, tenants } from "@/db/schema";
import { DomainError } from "@/lib/loyalty";
import type { WalletPassData } from "./types";

export async function walletPassDataByMembershipId(membershipId: string): Promise<WalletPassData> {
  const [row] = await db.select({ member: memberships, program: programs, location: locations, tenant: tenants })
    .from(memberships)
    .innerJoin(programs, and(eq(programs.id, memberships.programId), eq(programs.tenantId, memberships.tenantId)))
    .innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(memberships.id, membershipId));
  if (!row) throw new DomainError("NOT_FOUND", "Card not found");
  return {
    tenantId: row.tenant.id,
    membershipId: row.member.id,
    programId: row.program.id,
    merchantName: row.tenant.name,
    programName: row.program.name,
    locationName: row.location.name,
    programType: row.program.type === "points" ? "points" : "stamp",
    balance: row.member.balance,
    scanCode: row.member.scanCode,
    brandColor: row.location.brandColor,
    country: row.location.country,
    ...(row.location.latitude !== null && row.location.longitude !== null ? { latitude: row.location.latitude, longitude: row.location.longitude } : {}),
  };
}

export async function walletPassDataByCardToken(cardToken: string): Promise<WalletPassData> {
  const [member] = await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.cardToken, cardToken));
  if (!member) throw new DomainError("NOT_FOUND", "Card not found");
  return walletPassDataByMembershipId(member.id);
}
