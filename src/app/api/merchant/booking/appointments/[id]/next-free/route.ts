import { z } from "zod";
import { respondError } from "@/lib/http";
import { bookingStaffScope, NO_STORE, ownerNextFree, pathId } from "@/lib/booking/appointments";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { tenantId, locationId } = await bookingStaffScope(request);
    const { id } = await context.params;
    const params = new URL(request.url).searchParams;
    return Response.json(await ownerNextFree({ tenantId, locationId, appointmentId: pathId(id), from: z.iso.date().parse(params.get("from")), staffId: z.uuid().parse(params.get("staffId")) }), { headers: NO_STORE });
  } catch (error) { return respondError(error); }
}
