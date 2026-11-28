import { z } from "zod";
import { respondError } from "@/lib/http";
import { bookingStaffScope, dayView, NO_STORE } from "@/lib/booking/appointments";
import { dayExtras } from "@/lib/booking/owner-day";

export async function GET(request: Request) {
  try {
    const { tenantId, locationId } = await bookingStaffScope(request);
    const date = z.iso.date().optional().parse(new URL(request.url).searchParams.get("date") ?? undefined);
    const day = await dayView({ tenantId, locationId, date });
    return Response.json({ ...day, ...await dayExtras({ tenantId, locationId }, day.appointments.map(a => a.membershipId)) }, { headers: NO_STORE });
  } catch (error) { return respondError(error); }
}
