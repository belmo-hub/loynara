import { lookupCard } from "@/lib/product";
import { respondError, sessionUser } from "@/lib/http";
import { getMerchantContext } from "@/lib/product";
import { DomainError } from "@/lib/loyalty";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  try {
    await enforcePeerLimit(request, "cashier_lookup_peer", 300, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "cashier_lookup_user", identity: user.id, max: 120, windowSeconds: 15 * 60 });
    const context = await getMerchantContext(user.id);
    if (!context) throw new DomainError("FORBIDDEN", "No checkout access");
    const code = new URL(request.url).searchParams.get("code");
    if (!code || code.length > 64) throw new DomainError("INVALID_CODE", "Invalid card code");
    return Response.json(await lookupCard({ userId: user.id, locationId: context.locationId, scanCode: code }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
