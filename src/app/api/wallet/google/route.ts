import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { walletPasses } from "@/db/schema";
import { jsonBody, requireSameOrigin } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { walletAvailability } from "@/lib/wallet/capability";
import { walletCardSnapshot } from "@/lib/wallet/data";
import { googleConfig, googleObjectId, googleSaveUrl, GoogleWalletClient } from "@/lib/wallet/google";
import { cardTokenFrom, noStore, walletIssueError, walletUnavailable } from "@/lib/wallet/http";
import { issueWalletPass } from "@/lib/wallet/issue";

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
    const config = googleConfig();
    const pass = await issueWalletPass(token, "google", id => googleObjectId(id, config));
    const snapshot = await walletCardSnapshot(pass.membershipId);
    if (!snapshot.open || snapshot.credentialHash !== pass.credentialHash) throw new DomainError("NOT_FOUND", "Card not found");
    const object = await new GoogleWalletClient(config).upsert(snapshot.pass, pass.id, config);
    await db.update(walletPasses).set({ status: "created", syncedAt: new Date() }).where(and(eq(walletPasses.id, pass.id), eq(walletPasses.status, "pending")));
    const origin = process.env.PUBLIC_BASE_URL ? [new URL(process.env.PUBLIC_BASE_URL).origin] : [];
    return Response.json({ url: googleSaveUrl(object, config, origin) }, { headers: noStore });
  } catch (error) { return walletIssueError(error); }
}
