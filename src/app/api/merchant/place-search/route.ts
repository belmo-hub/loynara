import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { surfaceHidden } from "@/lib/pilot-surfaces";
import { maySetUpShop } from "@/lib/product";
import { placeSuggestions, sessionToken } from "@/lib/place-search";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

const query = z.object({ text: z.string().trim().min(2).max(120), sessionToken });

/** Setup's shop search (ENG-323): typed text in, up to five Google suggestions out. */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "place_search_peer", 240, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "place_search_user", identity: user.id, max: 120, windowSeconds: 15 * 60 });
    // Only an account in setup spends the Google quota the refresh job shares (review F-1).
    if (!await maySetUpShop(user.id)) throw new DomainError("FORBIDDEN", "Dafür fehlt dir die Berechtigung.");
    if (surfaceHidden("shopSearch")) return Response.json({ error: "Not offered" }, { status: 404 });
    const { text, sessionToken } = query.parse(await jsonBody(request, 2_000));
    const suggestions = await placeSuggestions(text, sessionToken);
    if (!suggestions) return Response.json({ error: "Place search failed" }, { status: 502 });
    return Response.json({ suggestions }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
