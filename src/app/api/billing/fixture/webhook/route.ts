import { applyFixtureWebhook, billingFixtureAvailable } from "@/lib/billing";
import { DomainError } from "@/lib/loyalty";
import { respondError } from "@/lib/http";
import { enforcePeerLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    if (!billingFixtureAvailable()) throw new DomainError("BILLING_DISABLED", "Local billing fixture is unavailable");
    await enforcePeerLimit(request, "billing_fixture_webhook_peer", 30, 15 * 60);
    const reader = request.body?.getReader();
    if (!reader) throw new DomainError("INVALID_JSON", "Empty fixture event");
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 2048) { await reader.cancel(); throw new DomainError("TOO_LARGE", "Fixture event is too large"); }
      chunks.push(value);
    }
    const raw = new TextDecoder().decode(Buffer.concat(chunks, total));
    return Response.json(await applyFixtureWebhook(raw, request.headers.get("x-looplocal-fixture-signature") ?? ""), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
