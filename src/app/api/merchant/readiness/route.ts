import { respondError, sessionUser } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { selectedLocationFromRequest } from "@/lib/locations";
import { getMerchantContext } from "@/lib/product";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { getLaunchReadiness } from "@/lib/readiness";

export async function GET(request: Request) {
  try {
    await enforcePeerLimit(request, "merchant_readiness_peer", 240, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_readiness_user", identity: user.id, max: 120, windowSeconds: 15 * 60 });
    const context = await getMerchantContext(user.id, selectedLocationFromRequest(request, user.id));
    if (!context) throw new DomainError("FORBIDDEN", "Owner or manager access required");
    return Response.json(await getLaunchReadiness(user.id, context.locationId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
