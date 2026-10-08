import { getMerchantContext } from "@/lib/product";
import { selectedLocationFromRequest } from "@/lib/locations";
import { jsonBody, requireSameOrigin, respondError, sessionWithUser } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { enforceRateLimit } from "@/lib/rate-limit";
import { deleteStaffPushSubscription, saveStaffPushSubscription } from "@/lib/staff-push";

/**
 * A staff device subscribes to NFC wake-ups for the location it works at. The subscription is bound to this login
 * session (signing out removes it) and to the location resolved from the session, never to a client-supplied one.
 */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const { user, sessionId } = await sessionWithUser(request);
    await enforceRateLimit({ scope: "push_subscribe_user", identity: user.id, max: 30, windowSeconds: 60 * 60 });
    const context = await getMerchantContext(user.id, selectedLocationFromRequest(request, user.id));
    if (!context) throw new DomainError("FORBIDDEN", "No checkout access");
    const subscription = await jsonBody(request, 4_000);
    return Response.json(await saveStaffPushSubscription({ userId: user.id, sessionId, tenantId: context.tenantId, locationId: context.locationId, subscription }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}

/** Removes this user's subscription for the given endpoint (turning notifications off on this device). */
export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request);
    const { user } = await sessionWithUser(request);
    await enforceRateLimit({ scope: "push_unsubscribe_user", identity: user.id, max: 60, windowSeconds: 60 * 60 });
    const body = await jsonBody(request, 2_000) as { endpoint?: unknown } | null;
    return Response.json(await deleteStaffPushSubscription({ userId: user.id, endpoint: body?.endpoint }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
