import { getCardReferralShare } from "@/lib/referrals";
import { respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    await enforcePeerLimit(request, "card_referral_peer", 120, 15 * 60);
    const { token } = await context.params;
    await enforceRateLimit({ scope: "card_referral_token", identity: token, max: 60, windowSeconds: 15 * 60 });
    return Response.json(await getCardReferralShare(token), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
