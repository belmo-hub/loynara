import { z } from "zod";
import { completeCardRecovery, recoveryOptions } from "@/lib/card-recovery";
import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), token: z.string().max(100) }).strict(),
  z.object({ action: z.literal("rotate"), token: z.string().max(100), membershipId: z.uuid() }).strict(),
]);
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "recovery_confirm_peer", 30, 60 * 60);
    const value = input.parse(await jsonBody(request, 1000));
    await enforceRateLimit({ scope: "recovery_confirm_token", identity: value.token, max: 12, windowSeconds: 60 * 60 });
    const result = value.action === "list" ? await recoveryOptions(value.token) : await completeCardRecovery(value.token, value.membershipId);
    return Response.json(result, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
