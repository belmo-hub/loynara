import { z } from "zod";
import { contactStatus, removeRecoveryEmail, requestContactVerification } from "@/lib/contact-verification";
import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

type Context = { params: Promise<{ token: string }> };
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const inputSchema = z.object({ email: z.string().min(3).max(320) }).strict();

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
    const { email } = inputSchema.parse(await jsonBody(request, 1500));
    const normalized = z.email().max(320).parse(email.trim().normalize("NFC").toLowerCase());
    await enforceRateLimit({ scope: "card_contact_destination", identity: normalized, max: 4, windowSeconds: 60 * 60 });
    return Response.json(await requestContactVerification(token, normalized), { headers });
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
