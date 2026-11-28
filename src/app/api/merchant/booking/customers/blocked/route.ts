import { respondError } from "@/lib/http";
import { bookingStaffScope, NO_STORE } from "@/lib/booking/appointments";
import { blockedCustomers } from "@/lib/booking/owner-day";

export async function GET(request: Request) {
  try {
    const { tenantId, locationId } = await bookingStaffScope(request);
    return Response.json({ customers: await blockedCustomers({ tenantId, locationId }) }, { headers: NO_STORE });
  } catch (error) { return respondError(error); }
}
