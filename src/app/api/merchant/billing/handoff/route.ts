import { createFixtureHandoff } from "@/lib/billing";
import { requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "merchant_billing_handoff_peer", 10, 60 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_billing_handoff_user", identity: user.id, max: 3, windowSeconds: 60 * 60 });
    return Response.json(await createFixtureHandoff(user.id), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
