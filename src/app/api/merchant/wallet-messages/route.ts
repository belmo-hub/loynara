import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { acknowledgeWalletGuidance, sendWalletMessage, walletMessageOverview } from "@/lib/wallet-messages";
import { getWinback, updateWinback } from "@/lib/winback";
import { setAlmostThere } from "@/lib/almost-there";

const programSlug = z.string().min(1).max(120);
// The one-time confirmation of Legal's guidance, a message, the win-back set-up (ENG-044) or the "Fast geschafft" switch (ENG-045).
const input = z.union([z.object({ programSlug, acknowledgeGuidance: z.literal(true) }).strict(), z.object({ programSlug, text: z.string().max(2000) }).strict(),
  z.object({ programSlug, winback: z.object({ enabled: z.boolean(), days: z.number(), bonus: z.number() }).strict() }).strict(),
  z.object({ programSlug, almost: z.boolean() }).strict()]);
const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

// Owner only (ownerProgram) and not offered while the walletMessages surface is withheld. The owner sees counts, never names.
export async function GET(request: Request) {
  try {
    await enforcePeerLimit(request, "merchant_wallet_messages_peer", 120, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_wallet_messages_read", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    const slug = new URL(request.url).searchParams.get("programSlug");
    if (!slug) return Response.json({ error: "Missing programme" }, { status: 400, headers: noStore });
    const owner = { actorUserId: user.id, programSlug: slug };
    return Response.json({ ...await walletMessageOverview(owner), winback: await getWinback(owner) }, { headers: noStore });
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
    if ("almost" in body) return Response.json(await setAlmostThere({ actorUserId: user.id, programSlug: body.programSlug, enabled: body.almost }), { headers: noStore });
    if ("winback" in body) return Response.json(await updateWinback({ actorUserId: user.id, programSlug: body.programSlug, settings: body.winback }), { headers: noStore });
    return Response.json(await sendWalletMessage({ actorUserId: user.id, ...body }), { headers: noStore });
  } catch (error) { return respondError(error); }
}
