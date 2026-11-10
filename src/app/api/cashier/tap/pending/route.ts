import { pendingTapRequests } from "@/lib/secure-tap";
import { getMerchantContext } from "@/lib/product";
import { selectedLocationFromRequest } from "@/lib/locations";
import { sessionUser, respondError } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { appointmentsForTaps } from "@/lib/booking/cashier";

export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    const context = await getMerchantContext(user.id, selectedLocationFromRequest(request, user.id));
    if (!context) throw new DomainError("FORBIDDEN", "Du hast an diesem Standort keinen Kassenzugang.");
    const taps = await pendingTapRequests({ userId: user.id, locationId: context.locationId });
    const appointments = await appointmentsForTaps(context.locationId, taps.map(tap => tap.id));
    return Response.json(taps.map(tap => ({ ...tap, appointment: appointments.get(tap.id) ?? null })), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
