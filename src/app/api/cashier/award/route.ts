import { z } from "zod";
import { award } from "@/lib/loyalty";
import { getMerchantContext } from "@/lib/product";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { MAX_PURCHASE_AMOUNT_MINOR } from "@/lib/points";
import { selectedLocationFromRequest } from "@/lib/locations";
import { enforceRateLimit } from "@/lib/rate-limit";

const common = { membershipId: z.uuid(), idempotencyKey: z.string().min(8).max(100), requestId: z.uuid(), deviceAt: z.iso.datetime().optional() };
const body = z.union([
  z.object({ ...common, quantity: z.number().int().min(1) }).strict(),
  z.object({ ...common, purchaseAmountMinor: z.number().int().min(1).max(MAX_PURCHASE_AMOUNT_MINOR), ruleVersionId: z.uuid() }).strict(),
]);
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    // A counter serves fewer guests than this; a stolen or misused login cannot book without end (lookup has the same 120).
    await enforceRateLimit({ scope: "cashier_award_user", identity: user.id, max: 120, windowSeconds: 15 * 60 });
    const context = await getMerchantContext(user.id, selectedLocationFromRequest(request, user.id));
    if (!context) throw new DomainError("FORBIDDEN", "Du hast an diesem Standort keinen Kassenzugang.");
    const { deviceAt, ...input } = body.parse(await jsonBody(request, 2000));
    // Per card, shared with redemptions and keyed with the location so another shop cannot use up the card's allowance.
    await enforceRateLimit({ scope: "cashier_booking_card", identity: `${context.locationId}:${input.membershipId}`, max: 20, windowSeconds: 15 * 60 });
    return Response.json(await award({ ...input, userId: user.id, locationId: context.locationId, deviceAt: deviceAt ? new Date(deviceAt) : undefined }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
