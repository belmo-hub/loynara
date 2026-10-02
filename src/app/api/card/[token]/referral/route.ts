import { getCardReferralShare } from "@/lib/referrals";
import { DomainError } from "@/lib/loyalty";
import { respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    await enforcePeerLimit(request, "card_referral_peer", 120, 15 * 60);
    const { token } = await context.params;
    await enforceRateLimit({ scope: "card_referral_token", identity: token, max: 60, windowSeconds: 15 * 60 });
    const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
    // Referrals are off by default. A disabled programme is a normal state, not an error: answer 200 so an
    // ordinary card view does not produce a failed request. All other failures (unknown or closed card) keep their status.
    try { return Response.json(await getCardReferralShare(token), { headers }); }
    catch (error) { if (error instanceof DomainError && error.code === "REFERRAL_DISABLED") return Response.json({ enabled: false }, { headers }); throw error; }
  } catch (error) { return respondError(error); }
}
