import { pendingTapRequests } from "@/lib/secure-tap";
import { getMerchantContext } from "@/lib/product";
import { selectedLocationFromRequest } from "@/lib/locations";
import { sessionUser, respondError } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";

export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    const context = await getMerchantContext(user.id, selectedLocationFromRequest(request, user.id));
    if (!context) throw new DomainError("FORBIDDEN", "No checkout access");
    return Response.json(await pendingTapRequests({ userId: user.id, locationId: context.locationId }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
