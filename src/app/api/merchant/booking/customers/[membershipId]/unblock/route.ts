import { requireSameOrigin, respondError } from "@/lib/http";
import { bookingStaffScope, pathId, unblockCustomer } from "@/lib/booking/appointments";

export async function POST(request: Request, context: { params: Promise<{ membershipId: string }> }) {
  try {
    requireSameOrigin(request);
    const { tenantId, locationId } = await bookingStaffScope(request);
    const { membershipId } = await context.params;
    await unblockCustomer({ tenantId, locationId, membershipId: pathId(membershipId) });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
