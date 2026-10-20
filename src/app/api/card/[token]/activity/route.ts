import { recordCustomerActivity } from "@/lib/inactivity";
import { requireSameOrigin, respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "card_activity_peer", 120, 3600);
    const { token } = await context.params;
    await enforceRateLimit({ scope: "card_activity", identity: token, max: 30, windowSeconds: 3600 });
    return Response.json(await recordCustomerActivity(token), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
