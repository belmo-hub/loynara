import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { configureReferrals, getReferralSettings } from "@/lib/referrals";

const input = z.object({ programSlug: z.string().min(1).max(120), enabled: z.boolean(), referrerBonus: z.number().int().min(0).max(1000), referredBonus: z.number().int().min(0).max(1000) }).strict();

export async function GET(request: Request) {
  try {
    await enforcePeerLimit(request, "merchant_referral_settings_peer", 120, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_referral_settings_user", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    const programSlug = z.string().min(1).max(120).parse(new URL(request.url).searchParams.get("programSlug"));
    return Response.json(await getReferralSettings({ actorUserId: user.id, programSlug }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_referral_settings_write", identity: user.id, max: 30, windowSeconds: 15 * 60 });
    const body = input.parse(await jsonBody(request, 2000));
    return Response.json(await configureReferrals({ ...body, actorUserId: user.id }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
