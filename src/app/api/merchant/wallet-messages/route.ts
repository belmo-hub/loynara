import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { acknowledgeWalletGuidance, sendWalletMessage, walletMessageOverview } from "@/lib/wallet-messages";

const programSlug = z.string().min(1).max(120);
// Either the one-time confirmation of Legal's guidance, or a message.
const input = z.union([z.object({ programSlug, acknowledgeGuidance: z.literal(true) }).strict(), z.object({ programSlug, text: z.string().max(2000) }).strict()]);
const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

// Owner only (ownerProgram) and not offered while the walletMessages surface is withheld. The owner sees counts, never names.
export async function GET(request: Request) {
  try {
    await enforcePeerLimit(request, "merchant_wallet_messages_peer", 120, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_wallet_messages_read", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    const slug = new URL(request.url).searchParams.get("programSlug");
    if (!slug) return Response.json({ error: "Missing programme" }, { status: 400, headers: noStore });
    return Response.json(await walletMessageOverview({ actorUserId: user.id, programSlug: slug }), { headers: noStore });
  } catch (error) { return respondError(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "merchant_wallet_messages_peer", 60, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_wallet_messages_write", identity: user.id, max: 20, windowSeconds: 15 * 60 });
    const body = input.parse(await jsonBody(request, 4000));
    if ("acknowledgeGuidance" in body) return Response.json(await acknowledgeWalletGuidance({ actorUserId: user.id, programSlug: body.programSlug }), { headers: noStore });
    return Response.json(await sendWalletMessage({ actorUserId: user.id, ...body }), { headers: noStore });
  } catch (error) { return respondError(error); }
}
