import { respondError } from "@/lib/http";
import { cancelByCustomer, cardBookingLimits, NO_STORE, pathId } from "@/lib/booking/appointments";

export async function POST(request: Request, context: { params: Promise<{ token: string; id: string }> }) {
  try {
    const { token, id } = await context.params;
    await cardBookingLimits(request, token, true);
    return Response.json(await cancelByCustomer({ token, appointmentId: pathId(id) }), { headers: NO_STORE });
  } catch (error) { return respondError(error); }
}
