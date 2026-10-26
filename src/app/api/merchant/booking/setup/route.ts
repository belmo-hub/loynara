import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";
import { bookingStaffScope, NO_STORE } from "@/lib/booking/appointments";
import { getSetup, saveSetup, setupInput } from "@/lib/booking/setup";

export async function GET(request: Request) {
  try {
    const scope = await bookingStaffScope(request);
    return Response.json(await getSetup(scope), { headers: NO_STORE });
  } catch (error) { return respondError(error); }
}

export async function PUT(request: Request) {
  try {
    requireSameOrigin(request);
    const { tenantId, locationId } = await bookingStaffScope(request, true);
    return Response.json(await saveSetup({ tenantId, locationId }, setupInput.parse(await jsonBody(request, 100_000))), { headers: NO_STORE });
  } catch (error) { return respondError(error); }
}
