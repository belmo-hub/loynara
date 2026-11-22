import { db } from "@/db";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { setLocationCoordinates } from "@/lib/operator";
import { placeId } from "@/lib/place-search";
import { assertPlateOperator } from "@/lib/plates";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

/** Sets one location's coordinates. `execute` false is the check that reads the pasted text and changes nothing. Same gate as the plate route. */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "operator_coordinates_peer", 60, 15 * 60);
    const user = await sessionUser(request);
    // Before the limiter and the body: a non-operator learns nothing from a 400 or a 429.
    await db.transaction(tx => assertPlateOperator(tx, user.id, process.env));
    await enforceRateLimit({ scope: "operator_coordinates_user", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    const body = await jsonBody(request, 2000) as { tenantId?: unknown; locationId?: unknown; coordinates?: unknown; googlePlaceId?: unknown; execute?: unknown };
    if (typeof body.tenantId !== "string" || typeof body.locationId !== "string" || typeof body.coordinates !== "string" || typeof body.execute !== "boolean" || (body.googlePlaceId !== undefined && !placeId.safeParse(body.googlePlaceId).success)) throw new DomainError("INVALID_INPUT", "Bitte prüfe deine Eingaben und versuche es noch einmal.");
    const result = await setLocationCoordinates({ actorUserId: user.id, env: process.env, tenantId: body.tenantId, locationId: body.locationId, coordinates: body.coordinates, googlePlaceId: body.googlePlaceId as string | undefined, execute: body.execute });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DomainError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN" || error.code === "INVALID_ORIGIN")) return notFound();
    return respondError(error);
  }
}
