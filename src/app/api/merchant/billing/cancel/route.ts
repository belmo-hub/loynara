import { cancelSubscriptionAtPeriodEnd } from "@/lib/billing";
import { respondBillingError } from "@/lib/billing-errors";
import { requireSameOrigin, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "merchant_billing_cancel_peer", 10, 60 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_billing_cancel_user", identity: user.id, max: 3, windowSeconds: 60 * 60 });
    return Response.json(await cancelSubscriptionAtPeriodEnd(user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondBillingError(error); }
}
