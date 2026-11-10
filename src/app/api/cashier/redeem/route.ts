import { z } from "zod";
import { DomainError, redeem } from "@/lib/loyalty";
import { getMerchantContext } from "@/lib/product";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { selectedLocationFromRequest } from "@/lib/locations";
import { enforceRateLimit } from "@/lib/rate-limit";

const body = z.object({ membershipId: z.uuid(), rewardVersionId: z.uuid(), idempotencyKey: z.string().min(8).max(100), requestId: z.uuid(), deviceAt: z.iso.datetime().optional() });
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "cashier_redeem_user", identity: user.id, max: 120, windowSeconds: 15 * 60 });
    const context = await getMerchantContext(user.id, selectedLocationFromRequest(request, user.id));
    if (!context) throw new DomainError("FORBIDDEN", "Du hast an diesem Standort keinen Kassenzugang.");
    const { deviceAt, ...input } = body.parse(await jsonBody(request, 2000));
    // The same per-card allowance as awards (see the award route).
    await enforceRateLimit({ scope: "cashier_booking_card", identity: `${context.locationId}:${input.membershipId}`, max: 20, windowSeconds: 15 * 60 });
    return Response.json(await redeem({ ...input, userId: user.id, locationId: context.locationId, deviceAt: deviceAt ? new Date(deviceAt) : undefined }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
