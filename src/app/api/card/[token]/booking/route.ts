import { respondError } from "@/lib/http";
import { cardBookingLimits, cardView, NO_STORE } from "@/lib/booking/appointments";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    await cardBookingLimits(request, token);
    return Response.json(await cardView(token), { headers: NO_STORE });
  } catch (error) { return respondError(error); }
}
