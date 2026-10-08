import { getMerchantContext } from "@/lib/product";
import { selectedLocationFromRequest } from "@/lib/locations";
import { respondError, sessionUser } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { pushCapability } from "@/lib/staff-push";

/** Whether this deployment can wake cashier phones, and the public VAPID key to subscribe with. Staff only. */
export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    const context = await getMerchantContext(user.id, selectedLocationFromRequest(request, user.id));
    if (!context) throw new DomainError("FORBIDDEN", "No checkout access");
    return Response.json(pushCapability(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
