import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { getWinback, updateWinback } from "@/lib/winback";

const programSlug = z.string().min(1).max(120);
const input = z.object({ programSlug, winback: z.object({ enabled: z.boolean(), days: z.number(), bonus: z.number() }).strict() }).strict();
const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

// The win-back bonus set-up on Programm (ENG-089): owner only (ownerProgram), validated in lib/winback, and not withheld
// with the walletMessages surface; the Wallet reminders stay withheld there. Same limits as the wallet-messages route.
export async function GET(request: Request) {
  try {
    await enforcePeerLimit(request, "merchant_winback_peer", 120, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_winback_read", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    const slug = programSlug.safeParse(new URL(request.url).searchParams.get("programSlug"));
    if (!slug.success) return Response.json({ error: "Missing programme" }, { status: 400, headers: noStore });
    return Response.json(await getWinback({ actorUserId: user.id, programSlug: slug.data }), { headers: noStore });
  } catch (error) { return respondError(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "merchant_winback_peer", 60, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_winback_write", identity: user.id, max: 20, windowSeconds: 15 * 60 });
    const body = input.parse(await jsonBody(request, 1000));
    return Response.json(await updateWinback({ actorUserId: user.id, programSlug: body.programSlug, settings: body.winback }), { headers: noStore });
  } catch (error) { return respondError(error); }
}
