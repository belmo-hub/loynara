import { requireSameOrigin, respondError } from "@/lib/http";
import { bookingStaffScope, cancelAffected, NO_STORE, pathId } from "@/lib/booking/appointments";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const { tenantId, locationId } = await bookingStaffScope(request);
    const { id } = await context.params;
    return Response.json(await cancelAffected({ tenantId, locationId, blockId: pathId(id) }), { headers: NO_STORE });
  } catch (error) { return respondError(error); }
}
