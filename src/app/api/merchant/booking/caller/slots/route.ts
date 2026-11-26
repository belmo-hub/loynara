import { z } from "zod";
import { respondError } from "@/lib/http";
import { bookingStaffScope, callerSlots, NO_STORE } from "@/lib/booking/appointments";

export async function GET(request: Request) {
  try {
    const { tenantId, locationId } = await bookingStaffScope(request);
    const params = new URL(request.url).searchParams;
    return Response.json(await callerSlots({ tenantId, locationId, serviceId: z.uuid().parse(params.get("serviceId")), date: z.iso.date().parse(params.get("date")) }), { headers: NO_STORE });
  } catch (error) { return respondError(error); }
}
