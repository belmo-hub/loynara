import { z } from "zod";
import { contactStatus, removeRecoveryEmail, requestContactVerification, storedContactEmail } from "@/lib/contact-verification";
import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

type Context = { params: Promise<{ token: string }> };
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
// No email: send the link again to the stored address. marketing: the link also confirms the marketing consent.
const inputSchema = z.object({ email: z.string().min(3).max(320).optional(), marketing: z.boolean().optional() }).strict();

export async function GET(request: Request, context: Context) {
  try {
    await enforcePeerLimit(request, "card_contact_peer", 60, 60 * 60);
    const { token } = await context.params;
    await enforceRateLimit({ scope: "card_contact_token", identity: token, max: 30, windowSeconds: 60 * 60 });
    return Response.json(await contactStatus(token), { headers });
  } catch (error) { return respondError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "card_contact_peer", 30, 60 * 60);
    const { token } = await context.params;
    await enforceRateLimit({ scope: "card_contact_token", identity: token, max: 10, windowSeconds: 60 * 60 });
    const { email, marketing } = inputSchema.parse(await jsonBody(request, 1500));
    const normalized = email === undefined ? undefined : z.email().max(320).parse(email.trim().normalize("NFC").toLowerCase());
    // Every mail counts against its recipient: a resend goes to the stored address and is limited like a typed one.
    const destination = normalized ?? await storedContactEmail(token);
    if (destination) await enforceRateLimit({ scope: "card_contact_destination", identity: destination, max: 4, windowSeconds: 60 * 60 });
    return Response.json(await requestContactVerification(token, normalized, marketing), { headers });
  } catch (error) { return respondError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "card_contact_remove_peer", 12, 60 * 60);
    const { token } = await context.params;
    await enforceRateLimit({ scope: "card_contact_remove_token", identity: token, max: 3, windowSeconds: 60 * 60 });
    return Response.json(await removeRecoveryEmail(token), { headers });
  } catch (error) { return respondError(error); }
}
