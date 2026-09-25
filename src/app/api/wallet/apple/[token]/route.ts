import { db } from "@/db";
import { walletPasses } from "@/db/schema";
import { respondError } from "@/lib/http";
import { applePassArchive, appleSigningConfig, appleWalletStatus } from "@/lib/wallet/apple";
import { walletPassDataByCardToken } from "@/lib/wallet/data";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const status = appleWalletStatus();
  if (!status.ready) return Response.json({ error: status.reason, code: "WALLET_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  try {
    const pass = await walletPassDataByCardToken((await context.params).token);
    const buffer = await applePassArchive(pass, appleSigningConfig());
    await db.insert(walletPasses).values({ tenantId: pass.tenantId, membershipId: pass.membershipId, provider: "apple", providerObjectId: pass.membershipId, status: "downloaded" })
      .onConflictDoUpdate({ target: [walletPasses.membershipId, walletPasses.provider], set: { updatedAt: new Date() } });
    return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.apple.pkpass", "Content-Disposition": "attachment; filename=looplocal.pkpass", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
