import { z } from "zod";
import { respondError } from "@/lib/http";
import { bookingStaffScope, callerNextFree, NO_STORE } from "@/lib/booking/appointments";

export async function GET(request: Request) {
  try {
    const { tenantId, locationId } = await bookingStaffScope(request);
    const params = new URL(request.url).searchParams;
    const staffId = params.get("staffId");
    return Response.json(await callerNextFree({ tenantId, locationId, serviceId: z.uuid().parse(params.get("serviceId")), from: z.iso.date().parse(params.get("from")), staffId: staffId ? z.uuid().parse(staffId) : undefined }), { headers: NO_STORE });
  } catch (error) { return respondError(error); }
}
