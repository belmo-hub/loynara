import { z } from "zod";
import { respondError } from "@/lib/http";
import { bookingStaffScope, NO_STORE, ownerSlots, pathId } from "@/lib/booking/appointments";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { tenantId, locationId } = await bookingStaffScope(request);
    const { id } = await context.params;
    const date = z.iso.date().parse(new URL(request.url).searchParams.get("date"));
    return Response.json(await ownerSlots({ tenantId, locationId, appointmentId: pathId(id), date }), { headers: NO_STORE });
  } catch (error) { return respondError(error); }
}
