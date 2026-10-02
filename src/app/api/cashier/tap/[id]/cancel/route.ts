import { cancelTapRequest } from "@/lib/secure-tap";
import { getMerchantContext } from "@/lib/product";
import { selectedLocationFromRequest } from "@/lib/locations";
import { sessionUser, respondError, requireSameOrigin } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "tap_cancel_user", identity: user.id, max: 120, windowSeconds: 15 * 60 });
    const context = await getMerchantContext(user.id, selectedLocationFromRequest(request, user.id));
    if (!context) throw new DomainError("FORBIDDEN", "No checkout access");
    const { id } = await route.params;
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new DomainError("NOT_FOUND", "Pending tap not found");
    return Response.json(await cancelTapRequest({ userId: user.id, locationId: context.locationId, requestId: id }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
