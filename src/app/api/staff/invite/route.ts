import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { createStaffInvite } from "@/lib/staff";
import { DomainError } from "@/lib/loyalty";
import { selectedLocationFromRequest } from "@/lib/locations";
import { getMerchantContext } from "@/lib/product";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "staff_invite_peer", 30, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "staff_invite_user", identity: user.id, max: 20, windowSeconds: 15 * 60 });
    const body = await jsonBody(request, 3000) as Record<string, unknown>;
    const context = await getMerchantContext(user.id, selectedLocationFromRequest(request, user.id));
    // Any of the owner's locations, not only the active one (ENG-179, fault 18): createStaffInvite checks the owner role
    // and that the location belongs to the owner's tenant.
    if (!context) throw new DomainError("NOT_FOUND", "Bitte wähle zuerst einen Standort.");
    const result = await createStaffInvite({ ...body, actorUserId: user.id } as Parameters<typeof createStaffInvite>[0]);
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
