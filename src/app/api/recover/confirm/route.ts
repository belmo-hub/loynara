import { cookieValue } from "@/lib/customer-session";
import { bindTapCard, tapCookieHeader, tapCookieName, tapMemberSession } from "@/lib/secure-tap";
import { returningMemberSession, returningCardCookieName, returningCardCookieHeader, clearLegacyReturningCardCookieHeader } from "@/lib/returning-card";
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
    const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    if (value.action === "list") return Response.json(await recoveryOptions(value.token), { headers });
    // An explicitly selected membership plus a single-use verified-email challenge is independent identity proof.
    const result = await completeCardRecovery(value.token, value.membershipId);
    const programId = await bindTapCard(result.cardToken);
    const previous = returningMemberSession(request, programId);
    const tap = tapMemberSession(request, programId);
    // The modern alias receives both cookie scopes. Older routes cannot inspect tap-only shared identity,
    // so conservatively retain explicit selection instead of silently clearing it.
    const seesTapScope = new URL(request.url).pathname.startsWith("/api/tap/");
    const shared = !seesTapScope || tap?.shared === true || previous?.shared === true
      || cookieValue(request, tapCookieName(programId)) !== undefined || cookieValue(request, returningCardCookieName(programId)) !== undefined;
    headers.append("Set-Cookie", tapCookieHeader(programId, result.cardToken, request.url, shared));
    headers.append("Set-Cookie", clearLegacyReturningCardCookieHeader(programId, request.url));
    headers.append("Set-Cookie", returningCardCookieHeader(programId, result.cardToken, request.url, shared)!);
    return Response.json(result, { headers });
  } catch (error) { return respondError(error); }
}
