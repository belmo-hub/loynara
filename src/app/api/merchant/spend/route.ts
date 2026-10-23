import { respondError, sessionUser } from "@/lib/http";
import { getMerchantSpend } from "@/lib/merchant-analytics";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  try {
    await enforcePeerLimit(request, "merchant_spend_peer", 120, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_spend_user", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    return Response.json(await getMerchantSpend(user.id), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
