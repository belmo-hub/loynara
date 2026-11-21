import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { surfaceHidden } from "@/lib/pilot-surfaces";
import { maySetUpShop } from "@/lib/product";
import { placeId, placeLocation, sessionToken } from "@/lib/place-search";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

const pick = z.object({ placeId, sessionToken });

/** The picked suggestion's latitude and longitude, nothing else (ENG-323). */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "place_location_peer", 60, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "place_location_user", identity: user.id, max: 30, windowSeconds: 15 * 60 });
    // Only an account in setup spends the Google quota the refresh job shares (review F-1).
    if (!await maySetUpShop(user.id)) throw new DomainError("FORBIDDEN", "Dafür fehlt dir die Berechtigung.");
    if (surfaceHidden("shopSearch")) return Response.json({ error: "Not offered" }, { status: 404 });
    const { placeId, sessionToken } = pick.parse(await jsonBody(request, 2_000));
    const location = await placeLocation(placeId, sessionToken);
    if (!location) return Response.json({ error: "Place lookup failed" }, { status: 502 });
    return Response.json(location, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
