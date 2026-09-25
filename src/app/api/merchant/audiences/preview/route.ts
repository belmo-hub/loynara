import { z } from "zod";
import { respondError, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { audienceDefinitionSchema, selectAudienceBySlug } from "@/lib/segments";

const slugSchema = z.string().min(1).max(120);

export async function GET(request: Request) {
  try {
    await enforcePeerLimit(request, "merchant_audience_preview_peer", 120, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_audience_preview_user", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    const params = new URL(request.url).searchParams;
    const programSlug = slugSchema.parse(params.get("programSlug"));
    const definition = audienceDefinitionSchema.parse({
      kind: params.get("kind"),
      ...(params.has("withinDays") && { withinDays: Number(params.get("withinDays")) }),
      ...(params.has("daysSinceLast") && { daysSinceLast: Number(params.get("daysSinceLast")) }),
      ...(params.has("minCheckouts") && { minCheckouts: Number(params.get("minCheckouts")) }),
      ...(params.has("maxRemaining") && { maxRemaining: Number(params.get("maxRemaining")) }),
      ...(params.has("rewardId") && { rewardId: params.get("rewardId") }),
    });
    const result = await selectAudienceBySlug({ actorUserId: user.id, programSlug, definition, limit: 1 });
    return Response.json({ total: result.total, asOf: result.asOf, countingRule: result.countingRule },
      { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
