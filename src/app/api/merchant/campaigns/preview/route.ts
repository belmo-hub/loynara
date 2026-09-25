import { z } from "zod";
import { previewCampaign } from "@/lib/campaigns";
import { audienceDefinitionSchema } from "@/lib/segments";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

const body = z.object({ programSlug: z.string().min(1).max(120), audienceDefinition: audienceDefinitionSchema }).strict();

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "merchant_campaign_preview_peer", 120, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_campaign_preview_user", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    return Response.json(await previewCampaign({ actorUserId: user.id, ...body.parse(await jsonBody(request, 3000)) }), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
