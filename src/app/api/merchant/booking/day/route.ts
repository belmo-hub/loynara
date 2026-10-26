import { z } from "zod";
import { respondError } from "@/lib/http";
import { bookingStaffScope, dayView, NO_STORE } from "@/lib/booking/appointments";

export async function GET(request: Request) {
  try {
    const { tenantId, locationId } = await bookingStaffScope(request);
    const date = z.iso.date().parse(new URL(request.url).searchParams.get("date"));
    return Response.json(await dayView({ tenantId, locationId, date }), { headers: NO_STORE });
  } catch (error) { return respondError(error); }
}
