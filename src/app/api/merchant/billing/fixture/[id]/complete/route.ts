import { completeFixtureHandoff } from "@/lib/billing";
import { respondBillingError } from "@/lib/billing-errors";
import { requireSameOrigin, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "merchant_billing_fixture_complete_peer", 10, 60 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_billing_fixture_complete_user", identity: user.id, max: 3, windowSeconds: 60 * 60 });
    return Response.json(await completeFixtureHandoff(user.id, (await params).id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondBillingError(error); }
}
