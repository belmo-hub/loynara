import { requireSameOrigin, respondError } from "@/lib/http";
import { bookingStaffScope, deleteBlock, pathId } from "@/lib/booking/appointments";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const { tenantId, locationId } = await bookingStaffScope(request);
    const { id } = await context.params;
    await deleteBlock({ tenantId, locationId, blockId: pathId(id) });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
