import { after } from "next/server";
import { DomainError } from "@/lib/loyalty";
import { requireSameOrigin, respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { previewSecureTap, processSecureTap, tapCardToken, tapProgramId } from "@/lib/secure-tap";
import { dispatchTapPushNow } from "@/lib/staff-push";

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
function fields(request: Request) {
  const url = new URL(request.url);
  if (url.search.length > 55 || [...url.searchParams.keys()].sort().join(",") !== "c,e") throw new DomainError("INVALID_TAP", "Tap link invalid");
  const encrypted = url.searchParams.get("e") ?? "";
  const mac = url.searchParams.get("c") ?? "";
  if (!/^[a-fA-F0-9]{32}$/.test(encrypted) || !/^[a-fA-F0-9]{16}$/.test(mac)) throw new DomainError("INVALID_TAP", "Tap link invalid");
  return { encrypted, mac };
}
async function input(request: Request, ref: string) {
  await enforcePeerLimit(request, "tap_peer", 120, 15 * 60);
  await enforceRateLimit({ scope: "tap_ref", identity: ref, max: 600, windowSeconds: 15 * 60 });
  const dynamic = fields(request);
  const programId = await tapProgramId(ref);
  return { tagRef: ref, fields: dynamic, cardToken: tapCardToken(request, programId) };
}
export async function GET(request: Request, context: { params: Promise<{ ref: string }> }) {
  try { return Response.json(await previewSecureTap(await input(request, (await context.params).ref)), { headers }); }
  catch (error) { return respondError(error); }
}
export async function POST(request: Request, context: { params: Promise<{ ref: string }> }) {
  try {
    requireSameOrigin(request);
    if (request.headers.get("content-length") && request.headers.get("content-length") !== "0") throw new DomainError("INVALID_TAP", "Tap request invalid");
    const { pushJobId, ...result } = await processSecureTap(await input(request, (await context.params).ref));
    // Wake the cashier phones now rather than at the worker's next poll; the worker retries anything that fails here.
    if (pushJobId) after(() => dispatchTapPushNow(pushJobId));
    return Response.json(result, { headers });
  } catch (error) { return respondError(error); }
}
