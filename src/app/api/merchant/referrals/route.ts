import { z } from "zod";
import { respondError, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { listReferrals } from "@/lib/referrals";

export async function GET(request: Request) {
  try {
    await enforcePeerLimit(request, "merchant_referrals_peer", 120, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_referrals_user", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    const programSlug = z.string().min(1).max(120).parse(new URL(request.url).searchParams.get("programSlug"));
    return Response.json({ referrals: await listReferrals({ actorUserId: user.id, programSlug }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
