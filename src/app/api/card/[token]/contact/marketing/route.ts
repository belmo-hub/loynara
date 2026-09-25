import { z } from "zod";
import { setEmailMarketingPreference } from "@/lib/contact-verification";
import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

const inputSchema = z.object({ granted: z.boolean() }).strict();

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "card_contact_preference_peer", 60, 60 * 60);
    const { token } = await context.params;
    await enforceRateLimit({ scope: "card_contact_preference_token", identity: token, max: 30, windowSeconds: 60 * 60 });
    const { granted } = inputSchema.parse(await jsonBody(request, 500));
    return Response.json(await setEmailMarketingPreference(token, granted), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
