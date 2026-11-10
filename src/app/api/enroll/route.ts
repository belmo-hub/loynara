import { enroll, enrollInput } from "@/lib/product";
import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { clearLegacyReturningCardCookieHeader, findReturningCard, returningCardCookieHeader } from "@/lib/returning-card";
import { tapCookieHeader } from "@/lib/secure-tap";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "enroll_peer", 25, 15 * 60);
    const data = await jsonBody(request, 10_000);
    if (data && typeof data === "object" && ("email" in data || ("marketingOptIn" in data && data.marketingOptIn !== false))) {
      throw new DomainError("CONTACT_DISABLED", "Bitte erstelle zuerst deine Karte. Deine E-Mail-Adresse kannst du danach hinterlegen.");
    }
    const headers = new Headers({ "Cache-Control": "no-store" });
    let input = data;
    let shared = false;
    if (data && typeof data === "object" && "slug" in data && typeof data.slug === "string") {
      // A browser that already holds a valid card for this programme gets it offered again instead of a silent second,
      // empty card. Another card is created only when the guest deliberately asked for one (additionalCard: true).
      // Stale credentials require recovery or a deliberate request for a separate new card.
      const { additionalCard, ...rest } = data as Record<string, unknown>;
      if (additionalCard !== undefined && additionalCard !== true) throw new DomainError("INVALID_INPUT", "Die Anfrage ist unvollständig. Bitte lade die Seite neu und versuche es noch einmal.");
      // Checked before the shared limit below, so malformed requests cannot use it up.
      enrollInput.parse(rest);
      // Shared by every guest of this programme: 500 an hour is five addresses' worth of the per-address limit
      // (25 per 15 minutes is 100 an hour), so a busy shop has headroom and blocking its joins takes at least five addresses.
      await enforceRateLimit({ scope: "enroll_program", identity: data.slug, max: 500, windowSeconds: 60 * 60 });
      input = rest;
      const found = await findReturningCard(request, data.slug);
      if (found.state === "stale" && additionalCard !== true) throw new DomainError("RECOVERY_REQUIRED", "Öffne deinen aktuellen Kartenlink oder stelle deine Karte sicher wieder her.");
      shared = additionalCard === true;
      if (found.state === "existing" && additionalCard !== true) throw new DomainError("CARD_EXISTS", "Auf diesem Gerät gibt es schon eine Karte für dieses Programm.");
    }
    const result = await enroll(input as Parameters<typeof enroll>[0]);
    headers.append("Set-Cookie", tapCookieHeader(result.programId, result.cardToken, request.url, shared));
    const remember = returningCardCookieHeader(result.programId, result.cardToken, request.url, shared);
    if (remember) {
      headers.append("Set-Cookie", clearLegacyReturningCardCookieHeader(result.programId, request.url));
      headers.append("Set-Cookie", remember);
    }
    return Response.json({ cardToken: result.cardToken }, { status: 201, headers });
  } catch (error) { return respondError(error); }
}
