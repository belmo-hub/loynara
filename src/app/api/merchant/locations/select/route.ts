import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { selectionCookie, validateOwnerLocation } from "@/lib/locations";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "merchant_location_select_peer", 120, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_location_select_user", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    const { locationId } = z.object({ locationId: z.uuid() }).strict().parse(await jsonBody(request, 1000));
    const location = await validateOwnerLocation(user.id, locationId);
    return Response.json(location, { headers: { "Cache-Control": "no-store", "Set-Cookie": selectionCookie(user.id, location.id) } });
  } catch (error) { return respondError(error); }
}
