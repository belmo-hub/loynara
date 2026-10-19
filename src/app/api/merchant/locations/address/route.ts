import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { updateLocationAddress } from "@/lib/locations";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "merchant_location_address_peer", 60, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_location_address_user", identity: user.id, max: 30, windowSeconds: 15 * 60 });
    const body = await jsonBody(request, 4000);
    return Response.json(await updateLocationAddress(user.id, body as Parameters<typeof updateLocationAddress>[1]), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
