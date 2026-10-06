import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { locations, programs, staffRoles } from "@/db/schema";
import { DomainError } from "@/lib/loyalty";
import { walletAvailability } from "./capability";
import { passInk } from "./content";
import { appleLogoFromData, decodeMerchantLogoPng, merchantGoogleLogoUrl } from "./logo";

/**
 * What an owner needs to know about Wallet for one programme, in product terms only. Platform setup (certificates,
 * issuer account, keys) is Loynara's job and appears as "not_set_up", never as configuration detail.
 */
export type OwnerWalletReadiness = {
  apple: "ready" | "not_set_up";
  google: "ready" | "test_only" | "not_set_up";
  logo: "ready" | "needs_png" | "too_large" | "missing";
  /** Whether Google shows the merchant's own logo or the neutral Loynara fallback. */
  googleLogo: "merchant" | "fallback";
  ink: "light" | "dark";
  /** Unrevoked issued rows, including pending issuance. Neither a download nor a Google object proves a device save. */
  passes: { apple: number; google: number };
  /** Cards whose Wallet copy is currently behind because a provider update is waiting or failed. */
  delayedUpdates: number;
};

export async function ownerWalletReadiness(raw: { actorUserId: string; programSlug: string }): Promise<OwnerWalletReadiness> {
  const input = z.object({ actorUserId: z.string().min(1), programSlug: z.string().min(1).max(120) }).strict().parse(raw);
  const [program] = await db.select({ id: programs.id, tenantId: programs.tenantId, brandColor: locations.brandColor, logoData: locations.logoData })
    .from(programs).innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
    .where(and(eq(programs.slug, input.programSlug), eq(programs.status, "active"))).limit(1);
  if (!program) throw new DomainError("NOT_FOUND", "Programme not found");
  const [role] = await db.select({ userId: staffRoles.userId }).from(staffRoles)
    .where(and(eq(staffRoles.tenantId, program.tenantId), eq(staffRoles.userId, input.actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))).limit(1);
  if (!role) throw new DomainError("FORBIDDEN", "Owner access required");

  const availability = walletAvailability();
  const png = decodeMerchantLogoPng(program.logoData);
  const logo = !program.logoData ? "missing" : !png ? "needs_png" : appleLogoFromData(program.logoData) ? "ready" : "too_large";
  const counts = await db.execute<{ provider: string; n: number }>(sql`
    SELECT p.provider, count(*)::int AS n FROM wallet_passes p JOIN memberships m ON m.id = p.membership_id AND m.tenant_id = p.tenant_id
    WHERE p.tenant_id = ${program.tenantId}::uuid AND m.program_id = ${program.id}::uuid AND p.revoked_at IS NULL AND m.closed_at IS NULL
    GROUP BY p.provider`);
  const delayed = await db.execute<{ n: number }>(sql`
    SELECT count(DISTINCT j.payload ->> 'membershipId')::int AS n FROM outbox_jobs j
    JOIN memberships m ON m.id::text = j.payload ->> 'membershipId' AND m.tenant_id = j.tenant_id
    WHERE j.tenant_id = ${program.tenantId}::uuid AND m.program_id = ${program.id}::uuid AND j.kind = 'wallet.refresh'
      AND j.status IN ('retry', 'blocked', 'failed') AND m.closed_at IS NULL`);
  const byProvider = Object.fromEntries(counts.rows.map(row => [row.provider, Number(row.n)]));
  return {
    apple: availability.apple === "available" ? "ready" : "not_set_up",
    google: availability.google === "available" ? "ready" : availability.google === "test_only" ? "test_only" : "not_set_up",
    logo,
    googleLogo: merchantGoogleLogoUrl(program.id, program.logoData) ? "merchant" : "fallback",
    ink: passInk(program.brandColor),
    passes: { apple: byProvider.apple ?? 0, google: byProvider.google ?? 0 },
    delayedUpdates: Number(delayed.rows[0]?.n ?? 0),
  };
}
