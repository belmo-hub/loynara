import { db } from "@/db";
import { walletPasses } from "@/db/schema";
import { respondError } from "@/lib/http";
import { applePassArchive, appleSigningConfig, appleWalletStatus } from "@/lib/wallet/apple";
import { walletPassDataByCardToken } from "@/lib/wallet/data";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const status = appleWalletStatus();
  if (!status.ready) return Response.json({ error: status.reason, code: "WALLET_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  try {
    await enforcePeerLimit(request, "wallet_apple_peer", 30, 15 * 60);
    const { token } = await context.params;
    await enforceRateLimit({ scope: "wallet_apple_token", identity: token, max: 10, windowSeconds: 15 * 60 });
    const pass = await walletPassDataByCardToken(token);
    const buffer = await applePassArchive(pass, appleSigningConfig());
    await db.insert(walletPasses).values({ tenantId: pass.tenantId, membershipId: pass.membershipId, provider: "apple", providerObjectId: pass.membershipId, status: "downloaded" })
      .onConflictDoUpdate({ target: [walletPasses.membershipId, walletPasses.provider], set: { updatedAt: new Date() } });
    return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.apple.pkpass", "Content-Disposition": "attachment; filename=loynara.pkpass", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
