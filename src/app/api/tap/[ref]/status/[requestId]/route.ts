import { DomainError } from "@/lib/loyalty";
import { respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { secureTapStatus, tapCardToken, tapProgramId } from "@/lib/secure-tap";

export async function GET(request: Request, context: { params: Promise<{ ref: string; requestId: string }> }) {
  try {
    // A generous separate ingress cap protects unauthenticated reads without spending the fresh-tap allowance.
    await enforcePeerLimit(request, "tap_status_peer", 3000, 60);
    const { ref, requestId } = await context.params;
    if (!/^[a-f0-9-]{36}$/.test(requestId)) throw new DomainError("NOT_FOUND", "Tap unavailable");
    const programId = await tapProgramId(ref);
    const result = await secureTapStatus({ tagRef: ref, requestId, cardToken: tapCardToken(request, programId) });
    // Only a card-authorized request gets its own bucket: 180 reads cover the entire five-minute wait at four seconds.
    await enforceRateLimit({ scope: "tap_status_request", identity: requestId, max: 180, windowSeconds: 15 * 60 });
    return Response.json(result, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
