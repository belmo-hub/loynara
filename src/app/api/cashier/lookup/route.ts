import { lookupCard, previewCardLocator } from "@/lib/product";
import { isScanCodeInput } from "@/lib/card-locator";
import { respondError, sessionUser } from "@/lib/http";
import { getMerchantContext } from "@/lib/product";
import { DomainError } from "@/lib/loyalty";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { selectedLocationFromRequest } from "@/lib/locations";

export async function GET(request: Request) {
  try {
    await enforcePeerLimit(request, "cashier_lookup_peer", 300, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "cashier_lookup_user", identity: user.id, max: 120, windowSeconds: 15 * 60 });
    const context = await getMerchantContext(user.id, selectedLocationFromRequest(request, user.id));
    if (!context) throw new DomainError("FORBIDDEN", "No checkout access");
    const params = new URL(request.url).searchParams;
    const code = params.get("code");
    if (!code || code.length > 64) throw new DomainError("INVALID_CODE", "Invalid card code");
    const input = { userId: user.id, locationId: context.locationId, scanCode: code };
    // A scanned QR code opens the card directly. A typed locator first shows only a minimal preview; the cashier opens
    // the card with confirm=1 once it is the card in front of them.
    const result = isScanCodeInput(code) || params.get("confirm") === "1" ? await lookupCard(input) : await previewCardLocator(input);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
