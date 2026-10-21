import { respondError } from "@/lib/http";
import { enforcePeerLimit } from "@/lib/rate-limit";
import { recordPassFastEvent } from "@/lib/wallet-pass-events";

/**
 * PassFast event webhook (machine route: no origin check, no cookies). The signature over the raw body is the only
 * credential. Answers 2xx quickly for everything it has understood, including events for passes it does not know.
 */
export async function POST(request: Request) {
  try {
    await enforcePeerLimit(request, "passfast_events_peer", 600, 60);
    const raw = await request.text();
    if (raw.length > 8192) return new Response(null, { status: 413 });
    await recordPassFastEvent(raw, request.headers.get("x-webhook-signature"));
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
