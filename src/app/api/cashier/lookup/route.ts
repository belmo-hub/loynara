import { lookupCard } from "@/lib/product";
import { respondError, sessionUser } from "@/lib/http";
import { getMerchantContext } from "@/lib/product";
import { DomainError } from "@/lib/loyalty";

export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    const context = await getMerchantContext(user.id);
    if (!context) throw new DomainError("FORBIDDEN", "No checkout access");
    const code = new URL(request.url).searchParams.get("code");
    if (!code || code.length > 64) throw new DomainError("INVALID_CODE", "Invalid card code");
    return Response.json(await lookupCard({ userId: user.id, locationId: context.locationId, scanCode: code }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
