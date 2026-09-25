import { z } from "zod";
import { DomainError } from "@/lib/loyalty";
import { prepareOfflineAward } from "@/lib/offline-earning";
import { getMerchantContext } from "@/lib/product";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { selectedLocationFromRequest } from "@/lib/locations";

const body = z.object({ membershipId: z.uuid(), deviceId: z.uuid() }).strict();

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "offline_lease_peer", 60, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "offline_lease_user", identity: user.id, max: 30, windowSeconds: 15 * 60 });
    const context = await getMerchantContext(user.id, selectedLocationFromRequest(request, user.id));
    if (!context) throw new DomainError("FORBIDDEN", "No checkout access");
    const input = body.parse(await jsonBody(request, 1000));
    return Response.json(await prepareOfflineAward({ ...input, userId: user.id, locationId: context.locationId }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
