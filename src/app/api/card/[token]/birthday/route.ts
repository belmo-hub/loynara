import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { deleteCardBirthday, getCardBirthday, setCardBirthday } from "@/lib/birthday";

type Context = { params: Promise<{ token: string }> };
const privateHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const input = z.object({ day: z.number(), month: z.number() }).strict();

// Same scoping as the other card endpoints: the private card link is the credential.
async function limited(request: Request, context: Context) {
  await enforcePeerLimit(request, "card_birthday_peer", 60, 60 * 60);
  const { token } = await context.params;
  await enforceRateLimit({ scope: "card_birthday_token", identity: token, max: 30, windowSeconds: 60 * 60 });
  return token;
}

export async function GET(request: Request, context: Context) {
  try { return Response.json(await getCardBirthday(await limited(request, context)), { headers: privateHeaders }); }
  catch (error) { return respondError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    const token = await limited(request, context);
    return Response.json(await setCardBirthday(token, input.parse(await jsonBody(request, 200))), { headers: privateHeaders });
  } catch (error) { return respondError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    return Response.json(await deleteCardBirthday(await limited(request, context)), { headers: privateHeaders });
  } catch (error) { return respondError(error); }
}
