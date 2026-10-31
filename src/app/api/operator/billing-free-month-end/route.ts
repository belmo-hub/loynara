import { db } from "@/db";
import { endInFreeMonth } from "@/lib/billing-stripe";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { assertPlateOperator } from "@/lib/plates";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

/** ENG-123: the owner cancelled inside the free month; ends the Stripe subscription before the first invoice. Same gate as the plate and programme routes. */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "operator_billing_free_end_peer", 60, 15 * 60);
    const user = await sessionUser(request);
    // Before the limiter and the body: a non-operator learns nothing from a 400 or a 429.
    await db.transaction(tx => assertPlateOperator(tx, user.id, process.env));
    await enforceRateLimit({ scope: "operator_billing_free_end_user", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    const body = await jsonBody(request, 500) as { tenantId?: unknown };
    if (typeof body.tenantId !== "string") throw new DomainError("INVALID_INPUT", "Bitte prüfe deine Eingaben und versuche es noch einmal.");
    return Response.json(await endInFreeMonth({ actorUserId: user.id, env: process.env, tenantId: body.tenantId }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DomainError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN" || error.code === "INVALID_ORIGIN")) return notFound();
    return respondError(error);
  }
}
