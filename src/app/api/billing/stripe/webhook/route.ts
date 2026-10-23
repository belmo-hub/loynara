import { applyStripeWebhook, STRIPE_EVENT_MAX_BYTES } from "@/lib/billing-stripe";
import { DomainError } from "@/lib/loyalty";
import { respondError } from "@/lib/http";
import { enforcePeerLimit } from "@/lib/rate-limit";
import { stripeEnabled } from "@/lib/stripe-config";

/** Stripe webhook endpoint (customer.subscription.created, .updated, .deleted). Any non-2xx makes Stripe retry. */
export async function POST(request: Request) {
  try {
    if (!stripeEnabled()) throw new DomainError("BILLING_DISABLED", "Live billing is unavailable");
    await enforcePeerLimit(request, "billing_stripe_webhook_peer", 600, 15 * 60);
    const reader = request.body?.getReader();
    if (!reader) throw new DomainError("INVALID_JSON", "Empty Stripe event");
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > STRIPE_EVENT_MAX_BYTES) { await reader.cancel(); throw new DomainError("TOO_LARGE", "Stripe event is too large"); }
      chunks.push(value);
    }
    const raw = new TextDecoder().decode(Buffer.concat(chunks, total));
    return Response.json(await applyStripeWebhook(raw, request.headers.get("stripe-signature") ?? ""), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
