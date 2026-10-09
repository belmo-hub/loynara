import { and, eq } from "drizzle-orm";
import { walletPasses } from "@/db/schema";
import { requireSameOrigin } from "@/lib/http";
import { walletJsonBody } from "@/lib/wallet/body";
import { DomainError } from "@/lib/loyalty";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { walletDeploymentAvailability } from "@/lib/wallet/preparation";
import { walletCardEligibility } from "@/lib/wallet/eligibility";
import { walletCardSnapshot } from "@/lib/wallet/data";
import { googleObjectId, googleSaveUrl, GoogleWalletClient } from "@/lib/wallet/google";
import { googleDirectConfig } from "@/lib/wallet/google-direct";
import { cardTokenFrom, noStore, walletIssueError, walletUnavailable } from "@/lib/wallet/http";
import { issueWalletPass } from "@/lib/wallet/issue";
import { withGooglePassLock } from "@/lib/wallet/write";
import { withWalletDatabase, WALLET_DOWNLOAD_MS } from "@/lib/wallet/database";

/**
 * "Add to Google Wallet": the card page POSTs its bearer token in the body. The object for the card's current credential
 * is created or aligned through the REST API first; the returned Save link references it by id only.
 */
export async function POST(request: Request) {
  if (walletDeploymentAvailability().google === "unavailable") return walletUnavailable();
  const requestDeadline = Date.now() + WALLET_DOWNLOAD_MS;
  try {
    requireSameOrigin(request);
    const token = cardTokenFrom(await walletJsonBody(request, requestDeadline));
    return await withWalletDatabase(async (database, client, deadline) => {
    await enforcePeerLimit(request, "wallet_google_peer", 30, 15 * 60, client);
    await enforceRateLimit({ scope: "wallet_google_token", identity: token, max: 10, windowSeconds: 15 * 60 }, client);
    const eligibility = await walletCardEligibility(token, database);
    if (eligibility.availability.google === "unavailable") return walletUnavailable();
    const config = googleDirectConfig(process.env, eligibility.tenantId, eligibility.locationId, eligibility.programId);
    const pass = await issueWalletPass(token, "google", id => googleObjectId(id, config), database);
    const object = await withGooglePassLock(pass.id, async (tx, current) => {
      if (!current || current.revokedAt) throw new DomainError("NOT_FOUND", "Card not found");
      const snapshot = await walletCardSnapshot(current.membershipId, tx);
      if (!snapshot.open || snapshot.credentialHash !== current.credentialHash) throw new DomainError("NOT_FOUND", "Card not found");
      const latestConfig = googleDirectConfig(process.env, snapshot.pass.tenantId, snapshot.pass.locationId!, snapshot.pass.programId);
      if (current.providerObjectId !== googleObjectId(current.id, latestConfig)) throw new DomainError("FORBIDDEN", "Wallet unavailable");
      const object = await new GoogleWalletClient(latestConfig, fetch, Math.min(60_000, deadline - Date.now())).upsert(snapshot.pass, current.id, latestConfig);
      await tx.update(walletPasses).set({ status: "created", syncedAt: new Date() }).where(and(eq(walletPasses.id, current.id), eq(walletPasses.status, "pending")));
      return object;
    }, database);
    const origin = process.env.PUBLIC_BASE_URL ? [new URL(process.env.PUBLIC_BASE_URL).origin] : [];
    return Response.json({ url: googleSaveUrl(object, config, origin, undefined, config) }, { headers: noStore });
    }, requestDeadline - Date.now());
  } catch (error) { return walletIssueError(error); }
}
