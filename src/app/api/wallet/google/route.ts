import { and, eq } from "drizzle-orm";
import { walletPasses } from "@/db/schema";
import { jsonBody, requireSameOrigin } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { walletAvailability } from "@/lib/wallet/capability";
import { walletCardSnapshot } from "@/lib/wallet/data";
import { googleConfig, googleObjectId, googleSaveUrl, GoogleWalletClient } from "@/lib/wallet/google";
import { cardTokenFrom, noStore, walletIssueError, walletUnavailable } from "@/lib/wallet/http";
import { issueWalletPass } from "@/lib/wallet/issue";
import { withGooglePassLock } from "@/lib/wallet/write";
import { passFastObjectId } from "@/lib/wallet/passfast";
import { syncPassFastPass } from "@/lib/wallet/passfast-lifecycle";

/**
 * "Add to Google Wallet": the card page POSTs its bearer token in the body. The object for the card's current credential
 * is created or aligned through the REST API first; the returned Save link references it by id only.
 */
export async function POST(request: Request) {
  if (walletAvailability().google === "unavailable") return walletUnavailable();
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "wallet_google_peer", 30, 15 * 60);
    const token = cardTokenFrom(await jsonBody(request, 1000));
    await enforceRateLimit({ scope: "wallet_google_token", identity: token, max: 10, windowSeconds: 15 * 60 });
    if (process.env.PASSFAST_ENABLED === "true") {
      const pass = await issueWalletPass(token, "google", passFastObjectId);
      const result = await syncPassFastPass(pass.id, { tenantId: pass.tenantId });
      if (!result.saveUrl) throw new DomainError("NOT_FOUND", "Card not found");
      return Response.json({ url: result.saveUrl }, { headers: noStore });
    }
    const config = googleConfig();
    const pass = await issueWalletPass(token, "google", id => googleObjectId(id, config));
    const object = await withGooglePassLock(pass.id, async (tx, current) => {
      if (!current || current.revokedAt) throw new DomainError("NOT_FOUND", "Card not found");
      const snapshot = await walletCardSnapshot(current.membershipId, tx);
      if (!snapshot.open || snapshot.credentialHash !== current.credentialHash) throw new DomainError("NOT_FOUND", "Card not found");
      const object = await new GoogleWalletClient(config).upsert(snapshot.pass, current.id, config);
      await tx.update(walletPasses).set({ status: "created", syncedAt: new Date() }).where(and(eq(walletPasses.id, current.id), eq(walletPasses.status, "pending")));
      return object;
    });
    const origin = process.env.PUBLIC_BASE_URL ? [new URL(process.env.PUBLIC_BASE_URL).origin] : [];
    return Response.json({ url: googleSaveUrl(object, config, origin) }, { headers: noStore });
  } catch (error) { return walletIssueError(error); }
}
