import { z } from "zod";
import { jsonBody, respondError } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { unsubscribeMarketing } from "@/lib/unsubscribe";

export async function POST(request: Request) {
  try {
    const expected = new URL(process.env.PROMOTIONAL_UNSUBSCRIBE_ORIGIN || process.env.PUBLIC_BASE_URL || request.url).origin;
    if (request.headers.get("origin") !== expected) throw new DomainError("INVALID_ORIGIN", "Request origin not allowed");
    await enforcePeerLimit(request, "unsubscribe_peer", 30, 60 * 60);
    const input = z.object({ token: z.string().min(50).max(500) }).strict().parse(await jsonBody(request, 1000));
    await enforceRateLimit({ scope: "unsubscribe_token", identity: input.token, max: 10, windowSeconds: 60 * 60 });
    return Response.json(await unsubscribeMarketing(input.token), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
