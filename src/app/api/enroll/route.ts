import { enroll } from "@/lib/product";
import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { findReturningCard, returningCardCookieHeader } from "@/lib/returning-card";
import { tapCookieHeader } from "@/lib/secure-tap";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "enroll_peer", 25, 15 * 60);
    const data = await jsonBody(request, 10_000);
    if (data && typeof data === "object" && ("email" in data || ("marketingOptIn" in data && data.marketingOptIn !== false))) {
      throw new DomainError("CONTACT_DISABLED", "Email collection is unavailable until verified recovery is ready");
    }
    const headers = new Headers({ "Cache-Control": "no-store" });
    let input = data;
    if (data && typeof data === "object" && "slug" in data && typeof data.slug === "string") {
      await enforceRateLimit({ scope: "enroll_program", identity: data.slug, max: 300, windowSeconds: 60 * 60 });
      // A browser that already holds a valid card for this programme gets it offered again instead of a silent second,
      // empty card. Another card is created only when the guest deliberately asked for one (additionalCard: true).
      // A stale remembered card (closed, reissued, malformed) does not block; the new card replaces it below.
      const { additionalCard, ...rest } = data as Record<string, unknown>;
      if (additionalCard !== undefined && additionalCard !== true) throw new DomainError("INVALID_INPUT", "additionalCard must be true when present");
      input = rest;
      const found = await findReturningCard(request, data.slug);
      if (found.state === "existing" && additionalCard !== true) throw new DomainError("CARD_EXISTS", "Auf diesem Gerät gibt es schon eine Karte für dieses Programm.");
    }
    const result = await enroll(input as Parameters<typeof enroll>[0]);
    headers.append("Set-Cookie", tapCookieHeader(result.programId, result.cardToken, request.url));
    const remember = returningCardCookieHeader(result.programId, result.cardToken, request.url);
    if (remember) headers.append("Set-Cookie", remember);
    return Response.json({ cardToken: result.cardToken }, { status: 201, headers });
  } catch (error) { return respondError(error); }
}
