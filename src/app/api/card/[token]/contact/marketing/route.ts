import { z } from "zod";
import { withdrawEmailMarketing } from "@/lib/contact-verification";
import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

// Only withdrawal: the marketing consent is granted by clicking the confirmation link (POST ../contact with marketing).
const inputSchema = z.object({ granted: z.literal(false) }).strict();

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "card_contact_preference_peer", 60, 60 * 60);
    const { token } = await context.params;
    await enforceRateLimit({ scope: "card_contact_preference_token", identity: token, max: 30, windowSeconds: 60 * 60 });
    inputSchema.parse(await jsonBody(request, 500));
    return Response.json(await withdrawEmailMarketing(token), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
