import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";
import { bookingStaffScope, move, NO_STORE, pathId } from "@/lib/booking/appointments";

const body = z.object({ start: z.iso.datetime(), staffId: z.uuid() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const { tenantId, locationId } = await bookingStaffScope(request);
    const { id } = await context.params;
    const input = body.parse(await jsonBody(request, 1000));
    return Response.json(await move({ tenantId, locationId, appointmentId: pathId(id), start: new Date(input.start), staffId: input.staffId }), { headers: NO_STORE });
  } catch (error) { return respondError(error); }
}
