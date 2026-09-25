import { respondError, sessionUser } from "@/lib/http";
import { getMerchantMember } from "@/lib/merchant-members";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request, context: { params: Promise<{ membershipId: string }> }) {
  try {
    await enforcePeerLimit(request, "merchant_customer_detail_peer", 240, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_customer_detail_user", identity: user.id, max: 120, windowSeconds: 15 * 60 });
    const { membershipId } = await context.params;
    const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
    return Response.json(await getMerchantMember(user.id, membershipId, { cursor }), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
