import { z } from "zod";
import { respondError, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { ownerWalletReadiness } from "@/lib/wallet/readiness";

/** Owner-only Wallet readiness for one programme, in product terms (see lib/wallet/readiness). */
export async function GET(request: Request) {
  try {
    await enforcePeerLimit(request, "merchant_wallet_read_peer", 100, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_wallet_read_user", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    const programSlug = z.string().min(1).max(120).parse(new URL(request.url).searchParams.get("programSlug"));
    return Response.json(await ownerWalletReadiness({ actorUserId: user.id, programSlug }), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
