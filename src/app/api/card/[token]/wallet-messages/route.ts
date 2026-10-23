import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { getWalletConsent, setWalletConsent } from "@/lib/wallet-messages";

type Context = { params: Promise<{ token: string }> };
const privateHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const input = z.object({ granted: z.boolean() }).strict();

// Same scoping as the other card endpoints: the private card link is the credential. Not offered while the walletMessages surface is withheld.
export async function GET(request: Request, context: Context) {
  try {
    await enforcePeerLimit(request, "card_wallet_message_peer", 60, 60 * 60);
    const { token } = await context.params;
    await enforceRateLimit({ scope: "card_wallet_message_token", identity: token, max: 30, windowSeconds: 60 * 60 });
    return Response.json(await getWalletConsent(token), { headers: privateHeaders });
  } catch (error) { return respondError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "card_wallet_message_peer", 60, 60 * 60);
    const { token } = await context.params;
    await enforceRateLimit({ scope: "card_wallet_message_token", identity: token, max: 30, windowSeconds: 60 * 60 });
    const { granted } = input.parse(await jsonBody(request, 200));
    return Response.json(await setWalletConsent(token, granted), { headers: privateHeaders });
  } catch (error) { return respondError(error); }
}
