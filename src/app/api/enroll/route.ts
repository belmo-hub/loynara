import { enroll } from "@/lib/product";
import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { tapCookieHeader } from "@/lib/secure-tap";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "enroll_peer", 25, 15 * 60);
    const data = await jsonBody(request, 10_000);
    if (data && typeof data === "object" && ("email" in data || ("marketingOptIn" in data && data.marketingOptIn !== false))) {
      throw new DomainError("CONTACT_DISABLED", "Email collection is unavailable until verified recovery is ready");
    }
    if (data && typeof data === "object" && "slug" in data && typeof data.slug === "string") {
      await enforceRateLimit({ scope: "enroll_program", identity: data.slug, max: 300, windowSeconds: 60 * 60 });
    }
    const result = await enroll(data as Parameters<typeof enroll>[0]);
    return Response.json({ cardToken: result.cardToken }, { status: 201, headers: { "Cache-Control": "no-store", "Set-Cookie": tapCookieHeader(result.programId, result.cardToken, request.url) } });
  } catch (error) { return respondError(error); }
}
