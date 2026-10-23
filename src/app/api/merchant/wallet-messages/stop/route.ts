import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { stopWalletMessage } from "@/lib/wallet-messages";

const input = z.object({ programSlug: z.string().min(1).max(120), messageId: z.uuid() }).strict();

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "merchant_wallet_messages_peer", 60, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_wallet_messages_write", identity: user.id, max: 20, windowSeconds: 15 * 60 });
    return Response.json(await stopWalletMessage({ actorUserId: user.id, ...input.parse(await jsonBody(request, 500)) }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
