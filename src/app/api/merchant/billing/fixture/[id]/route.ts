import { getFixtureHandoff } from "@/lib/billing";
import { respondBillingError } from "@/lib/billing-errors";
import { sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await enforcePeerLimit(request, "merchant_billing_fixture_read_peer", 30, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_billing_fixture_read_user", identity: user.id, max: 15, windowSeconds: 15 * 60 });
    return Response.json(await getFixtureHandoff(user.id, (await params).id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondBillingError(error); }
}
