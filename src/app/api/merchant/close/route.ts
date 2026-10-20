import { z } from "zod";
import { closeMerchant } from "@/lib/merchant-deletion";
import { jsonBody, requireSameOrigin, respondError, sessionWithUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
const bodySchema = z.object({ tenantId: z.uuid(), confirmation: z.string().max(180) }).strict();
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "merchant_close_peer", 10, 3600);
    const { user, sessionId } = await sessionWithUser(request);
    await enforceRateLimit({ scope: "merchant_close_user", identity: user.id, max: 5, windowSeconds: 3600 });
    const input = bodySchema.parse(await jsonBody(request, 1024));
    return Response.json(await closeMerchant({ actorUserId: user.id, sessionId, ...input }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
