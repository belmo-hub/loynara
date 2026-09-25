import { getCampaign } from "@/lib/campaigns";
import { respondError, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await enforcePeerLimit(request, "merchant_campaign_detail_peer", 120, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_campaign_detail_user", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    const { id } = await context.params;
    return Response.json(await getCampaign({ actorUserId: user.id, campaignId: id }), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
