import { getMarketingPreference, withdrawMarketingConsent } from "@/lib/email";
import { requireSameOrigin, respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

type Context = { params: Promise<{ token: string }> };
const privateHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function GET(request: Request, context: Context) {
  try {
    await enforcePeerLimit(request, "card_preference_peer", 60, 60 * 60);
    const { token } = await context.params;
    await enforceRateLimit({ scope: "card_preference_token", identity: token, max: 30, windowSeconds: 60 * 60 });
    return Response.json(await getMarketingPreference(token), { headers: privateHeaders });
  } catch (error) { return respondError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "card_preference_peer", 60, 60 * 60);
    const { token } = await context.params;
    await enforceRateLimit({ scope: "card_preference_token", identity: token, max: 30, windowSeconds: 60 * 60 });
    await withdrawMarketingConsent(token);
    return Response.json({ marketingEmail: false }, { headers: privateHeaders });
  } catch (error) { return respondError(error); }
}
