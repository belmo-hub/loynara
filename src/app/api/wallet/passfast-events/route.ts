import { respondError } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { enforcePeerLimit } from "@/lib/rate-limit";
import { passFastEventsAvailable, recordPassFastEvent } from "@/lib/wallet-pass-events";

const MAX_BYTES = 8192;

/** The raw body, read with a cap so an oversized or endless body is refused without buffering it. */
async function rawBody(request: Request) {
  if (Number(request.headers.get("content-length")) > MAX_BYTES) throw new DomainError("TOO_LARGE", "Request too large");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader?.read();
    if (!next || next.done) break;
    size += next.value.byteLength;
    if (size > MAX_BYTES) { await reader?.cancel(); throw new DomainError("TOO_LARGE", "Request too large"); }
    chunks.push(next.value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks, size));
}

/**
 * PassFast event webhook (machine route: no origin check, no cookies). The signature over the raw body is the only
 * credential. Answers 2xx quickly for everything it has understood, including events for passes it does not know.
 */
export async function POST(request: Request) {
  try {
    await enforcePeerLimit(request, "passfast_events_peer", 600, 60);
    if (!passFastEventsAvailable()) throw new DomainError("NOT_FOUND", "Not found");
    let raw: string;
    try { raw = await rawBody(request); } catch { return new Response(null, { status: 413 }); }
    await recordPassFastEvent(raw, request.headers.get("x-webhook-signature"));
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
