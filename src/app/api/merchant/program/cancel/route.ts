import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { surfaceHidden } from "@/lib/pilot-surfaces";
import { requestCancellation, withdrawCancellation } from "@/lib/programme-end";
import { enforceRateLimit } from "@/lib/rate-limit";

const input = z.object({ programSlug: z.string().min(1).max(120), withdraw: z.boolean().default(false) }).strict();

/** Owner only: record (or withdraw) the request to end the programme at the end of the month. Sends nothing to customers. */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    if (surfaceHidden("cancellation")) throw new DomainError("NOT_FOUND", "Nicht verfügbar"); // withheld on real production until Legal's gate closes
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_program_cancel_write", identity: user.id, max: 10, windowSeconds: 15 * 60 });
    const { programSlug, withdraw } = input.parse(await jsonBody(request, 500));
    const result = await (withdraw ? withdrawCancellation : requestCancellation)({ actorUserId: user.id, programSlug });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
