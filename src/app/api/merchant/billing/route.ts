import { getBillingOverview } from "@/lib/billing";
import { respondError, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  try {
    await enforcePeerLimit(request, "merchant_billing_read_peer", 60, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_billing_read_user", identity: user.id, max: 30, windowSeconds: 15 * 60 });
    return Response.json(await getBillingOverview(user.id), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
