import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { updateSender } from "@/lib/locations";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "merchant_sender_peer", 60, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_sender_user", identity: user.id, max: 30, windowSeconds: 15 * 60 });
    const body = await jsonBody(request, 4000);
    return Response.json(await updateSender(user.id, body as Parameters<typeof updateSender>[1]), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
