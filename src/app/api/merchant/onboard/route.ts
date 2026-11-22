import { createMerchant } from "@/lib/product";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    // The brand route's limits: setup can carry a logo that is costly to decode.
    await enforcePeerLimit(request, "merchant_onboard_peer", 30, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_onboard_user", identity: user.id, max: 15, windowSeconds: 15 * 60 });
    const data = await jsonBody(request);
    if (!data || typeof data !== "object") return Response.json({ error: "Invalid input" }, { status: 400 });
    const result = await createMerchant({ ...data, userId: user.id } as Parameters<typeof createMerchant>[0], { newShop: process.env.PUBLIC_REGISTRATION_ENABLED === "true", requireAcceptance: process.env.PUBLIC_REGISTRATION_ENABLED === "true" });
    return Response.json(result, { status: 201 });
  } catch (error) { return respondError(error); }
}
