import { z } from "zod";
import { confirmTapRequest } from "@/lib/secure-tap";
import { getMerchantContext } from "@/lib/product";
import { selectedLocationFromRequest } from "@/lib/locations";
import { jsonBody, sessionUser, respondError, requireSameOrigin } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { enforceRateLimit } from "@/lib/rate-limit";
import { MAX_PURCHASE_AMOUNT_MINOR } from "@/lib/points";

// A points request carries the cashier's entry, in the same shapes as a counter award; a stamp request has no body.
const award = z.union([
  z.object({ quantity: z.number().int().min(1) }).strict(),
  z.object({ purchaseAmountMinor: z.number().int().min(1).max(MAX_PURCHASE_AMOUNT_MINOR), ruleVersionId: z.uuid() }).strict(),
]);

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "tap_confirm_user", identity: user.id, max: 120, windowSeconds: 15 * 60 });
    const context = await getMerchantContext(user.id, selectedLocationFromRequest(request, user.id));
    if (!context) throw new DomainError("FORBIDDEN", "No checkout access");
    const { id } = await route.params;
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new DomainError("NOT_FOUND", "Pending tap not found");
    const entry = request.headers.get("content-type") ? award.parse(await jsonBody(request, 500)) : undefined;
    return Response.json(await confirmTapRequest({ userId: user.id, locationId: context.locationId, requestId: id, award: entry }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
