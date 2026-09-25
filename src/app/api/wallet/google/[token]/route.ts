import { db } from "@/db";
import { walletPasses } from "@/db/schema";
import { respondError } from "@/lib/http";
import { walletPassDataByCardToken } from "@/lib/wallet/data";
import { googleConfig, googleObject, googleSaveUrl, googleWalletStatus, GoogleWalletClient } from "@/lib/wallet/google";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const status = googleWalletStatus();
  if (!status.ready) return Response.json({ error: status.reason, code: "WALLET_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  try {
    await enforcePeerLimit(request, "wallet_google_peer", 30, 15 * 60);
    const { token } = await context.params;
    await enforceRateLimit({ scope: "wallet_google_token", identity: token, max: 10, windowSeconds: 15 * 60 });
    const pass = await walletPassDataByCardToken(token);
    const config = googleConfig();
    const objectId = await new GoogleWalletClient(config).upsert(pass, config);
    await db.insert(walletPasses).values({ tenantId: pass.tenantId, membershipId: pass.membershipId, provider: "google", providerObjectId: objectId, status: "created" })
      .onConflictDoUpdate({ target: [walletPasses.membershipId, walletPasses.provider], set: { updatedAt: new Date() } });
    return Response.json({ url: googleSaveUrl(googleObject(pass, config), config), publishingStatus: status.publishingStatus }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
