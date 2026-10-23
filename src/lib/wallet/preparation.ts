import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { outboxJobs, walletPasses } from "@/db/schema";
import { walletAvailability, type WalletAvailability } from "./capability";
import type { WalletCardEligibility } from "./eligibility";
import { assertPassFastBinding, isPassFastObjectId, passFastConfig, passFastStatus } from "./passfast";
import { createDownloadTicket } from "./ticket";
import { passFastEnv } from "./template-bindings";
import { googleDirectStatus } from "./google-direct";

export type ApplePreparation = { status: "unavailable" | "not_requested" | "pending" | "ready" | "failed"; url?: string; retryAfterSeconds?: number };
/** Server startup/early OFF gate only. Customer availability always resolves an authenticated card scope. */
export function walletDeploymentAvailability(): WalletAvailability {
  const google = googleDirectStatus();
  const googleAvailability = !google.ready ? "unavailable" : google.publishingStatus === "published" ? "available" : "test_only";
  if (process.env.PASSFAST_ENABLED === "true") {
    const ready = passFastStatus().ready;
    const platforms = ready ? passFastConfig().platforms : [];
    return { apple: platforms.includes("apple") ? "available" : "unavailable", google: googleAvailability };
  }
  return { ...walletAvailability(), google: googleAvailability };
}

/** Read-only projection/job reconciliation. This never queues work, contacts a provider, or accepts a pass ID. */
export async function applePreparation(eligibility: WalletCardEligibility, reader: Pick<typeof db, "select"> = db): Promise<ApplePreparation> {
  if (eligibility.availability.apple !== "available") return { status: "unavailable" };
  const [pass] = await reader.select().from(walletPasses).where(and(eq(walletPasses.tenantId,eligibility.tenantId),eq(walletPasses.membershipId,eligibility.membershipId),eq(walletPasses.provider,"apple"),eq(walletPasses.credentialHash,eligibility.credentialHash),isNull(walletPasses.revokedAt))).limit(1);
  if (!pass) return { status: "not_requested" };
  if (isPassFastObjectId(pass.providerObjectId)) {
    assertPassFastBinding(pass.providerObjectId,passFastConfig(await passFastEnv(eligibility.tenantId,eligibility.locationId,reader),eligibility.tenantId,eligibility.locationId));
    const jobs = await reader.select({ status:outboxJobs.status, nextAttemptAt:outboxJobs.nextAttemptAt }).from(outboxJobs)
      .where(and(eq(outboxJobs.tenantId,eligibility.tenantId),eq(outboxJobs.kind,"wallet.refresh"),sql`${outboxJobs.payload} ->> 'membershipId' = ${eligibility.membershipId}`,inArray(outboxJobs.status,["pending","processing","retry","blocked","failed"])))
      .orderBy(desc(outboxJobs.createdAt));
    const active = jobs.filter(job => ["pending","processing","retry"].includes(job.status));
    if (active.length) return { status:"pending",retryAfterSeconds:active.some(job => job.status !== "retry") ? 5 : Math.min(60,Math.max(5,Math.ceil((Math.min(...active.map(job => job.nextAttemptAt.getTime()))-Date.now())/1000))) };
    if (jobs.length || !["created","downloaded","registered"].includes(pass.status)) return { status:"failed" };
  }
  return { status:"ready",url:`/api/wallet/apple/download/${createDownloadTicket(pass.id)}` };
}
