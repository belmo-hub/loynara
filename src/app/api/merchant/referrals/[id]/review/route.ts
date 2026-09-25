import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { reviewReferral } from "@/lib/referrals";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(10).max(240) }).strict(),
  z.object({ action: z.literal("retry_reversal") }).strict(),
]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_referral_review_user", identity: user.id, max: 30, windowSeconds: 15 * 60 });
    const referralId = z.uuid().parse((await context.params).id);
    const body = input.parse(await jsonBody(request, 2000));
    return Response.json(await reviewReferral({ ...body, actorUserId: user.id, referralId }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
