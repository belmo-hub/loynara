import { z } from "zod";
import { jsonBody, respondError } from "@/lib/http";
import { cardBookingLimits, NO_STORE, pathId, reschedule } from "@/lib/booking/appointments";

const body = z.object({ start: z.iso.datetime(), staffId: z.uuid().optional() });

export async function POST(request: Request, context: { params: Promise<{ token: string; id: string }> }) {
  try {
    const { token, id } = await context.params;
    await cardBookingLimits(request, token, true);
    const input = body.parse(await jsonBody(request, 1000));
    return Response.json(await reschedule({ token, appointmentId: pathId(id), start: new Date(input.start), staffId: input.staffId }), { headers: NO_STORE });
  } catch (error) { return respondError(error); }
}
