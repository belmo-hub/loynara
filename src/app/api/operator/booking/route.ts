import { db } from "@/db";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { setBookingEnabled } from "@/lib/operator";
import { assertPlateOperator } from "@/lib/plates";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

/** Turns „Termin + Treue“ (online booking) on or off for one location. Same gate as the wallet-template route. */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "operator_booking_peer", 60, 15 * 60);
    const user = await sessionUser(request);
    // Before the limiter and the body: a non-operator learns nothing from a 400 or a 429.
    await db.transaction(tx => assertPlateOperator(tx, user.id, process.env));
    await enforceRateLimit({ scope: "operator_booking_user", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    const body = await jsonBody(request, 500) as { tenantId?: unknown; locationId?: unknown; enabled?: unknown };
    if (typeof body.tenantId !== "string" || typeof body.locationId !== "string" || typeof body.enabled !== "boolean") throw new DomainError("INVALID_INPUT", "Die Eingabe stimmt nicht.");
    return Response.json(await setBookingEnabled({ actorUserId: user.id, env: process.env, tenantId: body.tenantId, locationId: body.locationId, enabled: body.enabled }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DomainError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN" || error.code === "INVALID_ORIGIN")) return notFound();
    return respondError(error);
  }
}
