import { z } from "zod";
import { respondError } from "@/lib/http";
import { cardBookingLimits, customerSlots, NO_STORE } from "@/lib/booking/appointments";

const query = z.object({ serviceId: z.uuid(), staffId: z.uuid().optional(), from: z.iso.date(), days: z.coerce.number().int().min(1).max(14).default(7), appointmentId: z.uuid().optional() });

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    await cardBookingLimits(request, token);
    const params = Object.fromEntries([...new URL(request.url).searchParams].filter(([, value]) => value !== ""));
    return Response.json(await customerSlots(token, query.parse(params)), { headers: NO_STORE });
  } catch (error) { return respondError(error); }
}
