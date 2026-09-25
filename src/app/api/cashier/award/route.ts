import { z } from "zod";
import { award } from "@/lib/loyalty";
import { getMerchantContext } from "@/lib/product";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { MAX_PURCHASE_AMOUNT_MINOR } from "@/lib/points";

const common = { membershipId: z.uuid(), idempotencyKey: z.string().min(8).max(100), requestId: z.uuid(), deviceAt: z.iso.datetime().optional() };
const body = z.union([
  z.object({ ...common, quantity: z.number().int().min(1) }).strict(),
  z.object({ ...common, purchaseAmountMinor: z.number().int().min(1).max(MAX_PURCHASE_AMOUNT_MINOR), ruleVersionId: z.uuid() }).strict(),
]);
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    const context = await getMerchantContext(user.id);
    if (!context) throw new DomainError("FORBIDDEN", "No checkout access");
    const { deviceAt, ...input } = body.parse(await jsonBody(request, 2000));
    return Response.json(await award({ ...input, userId: user.id, locationId: context.locationId, deviceAt: deviceAt ? new Date(deviceAt) : undefined }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
