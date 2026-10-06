import { createAdditionalLocation, listMerchantLocations } from "@/lib/locations";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  try {
    // Read on every full load of the owner shell; a low cap silently dropped location-dependent views mid-session.
    await enforcePeerLimit(request, "merchant_locations_read_peer", 480, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_locations_read_user", identity: user.id, max: 240, windowSeconds: 15 * 60 });
    return Response.json(await listMerchantLocations(user.id), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "merchant_locations_create_peer", 20, 60 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_locations_create_user", identity: user.id, max: 5, windowSeconds: 60 * 60 });
    const body = await jsonBody(request, 7000);
    return Response.json(await createAdditionalLocation(user.id, body as Parameters<typeof createAdditionalLocation>[1]), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
