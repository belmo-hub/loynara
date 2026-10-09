import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { locations, memberships, programs, tenants } from "@/db/schema";
import { validCardToken } from "@/lib/card-lifecycle";
import { DomainError } from "@/lib/loyalty";
import { walletAvailability, type WalletAvailability } from "./capability";
import { credentialHash } from "./data";

export type WalletCardEligibility = { tenantId: string; locationId: string; programId: string; membershipId: string; credentialHash: string; availability: WalletAvailability };
/** Authenticate a current card bearer and resolve its tenant-owned programme/location. Never accept browser scope. */
export async function walletCardEligibility(cardToken: string, reader: Pick<typeof db, "select"> = db): Promise<WalletCardEligibility> {
  if (!validCardToken(cardToken)) throw new DomainError("NOT_FOUND", "Card not found");
  const [row] = await reader.select({ tenantId: tenants.id, locationId: locations.id, programId: programs.id, membershipId: memberships.id, scanCode: memberships.scanCode })
    .from(memberships)
    .innerJoin(programs, and(eq(programs.id, memberships.programId), eq(programs.tenantId, memberships.tenantId)))
    .innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.cardToken, cardToken), isNull(memberships.closedAt))).limit(1);
  if (!row) throw new DomainError("NOT_FOUND", "Card not found");
  return { tenantId: row.tenantId, locationId: row.locationId, programId: row.programId, membershipId: row.membershipId, credentialHash: credentialHash(row.scanCode), availability: walletAvailability(process.env, row.tenantId, row.locationId, row.programId) };
}
