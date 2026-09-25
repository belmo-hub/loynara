import { db } from "@/db";
import { walletPasses } from "@/db/schema";
import { respondError } from "@/lib/http";
import { walletPassDataByCardToken } from "@/lib/wallet/data";
import { googleConfig, googleObject, googleSaveUrl, googleWalletStatus, GoogleWalletClient } from "@/lib/wallet/google";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const status = googleWalletStatus();
  if (!status.ready) return Response.json({ error: status.reason, code: "WALLET_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  try {
    const pass = await walletPassDataByCardToken((await context.params).token);
    const config = googleConfig();
    const objectId = await new GoogleWalletClient(config).upsert(pass, config);
    await db.insert(walletPasses).values({ tenantId: pass.tenantId, membershipId: pass.membershipId, provider: "google", providerObjectId: objectId, status: "created" })
      .onConflictDoUpdate({ target: [walletPasses.membershipId, walletPasses.provider], set: { updatedAt: new Date() } });
    return Response.json({ url: googleSaveUrl(googleObject(pass, config), config), publishingStatus: status.publishingStatus }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
