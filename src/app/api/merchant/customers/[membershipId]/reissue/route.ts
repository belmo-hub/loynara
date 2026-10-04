import { z } from "zod";
import { reissueCardByStaff, VERIFICATION_METHODS } from "@/lib/card-reissue";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { selectedLocationFromRequest } from "@/lib/locations";
import { getMerchantContext } from "@/lib/product";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

const input = z.object({
  reason: z.string().trim().min(10).max(240),
  verificationMethod: z.enum(VERIFICATION_METHODS),
  entitlementConfirmed: z.literal(true),
  idempotencyKey: z.string().min(8).max(100),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ membershipId: string }> }) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "merchant_card_reissue_peer", 30, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_card_reissue_user", identity: user.id, max: 20, windowSeconds: 60 * 60 });
    const body = input.parse(await jsonBody(request, 2000));
    const merchant = await getMerchantContext(user.id, selectedLocationFromRequest(request, user.id));
    // Authorise before touching any data, so a cashier learns nothing about which cards exist.
    if (!merchant || merchant.role === "cashier") throw new DomainError("FORBIDDEN", "Manager or owner access required");
    const { membershipId } = await context.params;
    const result = await reissueCardByStaff({ actorUserId: user.id, locationId: merchant.locationId, membershipId, ...body });
    const base = process.env.PUBLIC_BASE_URL ?? new URL(request.url).origin;
    return Response.json({ membershipId: result.membershipId, cardUrl: new URL(`/card/${result.cardToken}`, base).href }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
