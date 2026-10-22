import { createStripePortal } from "@/lib/billing-stripe";
import { requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "merchant_billing_portal_peer", 20, 60 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_billing_portal_user", identity: user.id, max: 10, windowSeconds: 60 * 60 });
    return Response.json(await createStripePortal(user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
