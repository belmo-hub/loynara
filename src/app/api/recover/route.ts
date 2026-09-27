import { z } from "zod";
import { normalizeRecoveryEmail, requestCardRecovery } from "@/lib/card-recovery";
import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

const input = z.object({ email: z.string().max(320) }).strict();
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "recovery_request_peer", 12, 60 * 60);
    const email = normalizeRecoveryEmail(input.parse(await jsonBody(request, 1500)).email);
    await enforceRateLimit({ scope: "recovery_request_destination", identity: email, max: 3, windowSeconds: 60 * 60 });
    return Response.json(await requestCardRecovery(email), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
