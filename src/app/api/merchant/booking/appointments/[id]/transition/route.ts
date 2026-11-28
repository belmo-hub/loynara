import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";
import { bookingStaffScope, NO_STORE, pathId, transition } from "@/lib/booking/appointments";
import { MAX_PURCHASE_AMOUNT_MINOR } from "@/lib/points";

const status = z.enum(["requested", "confirmed", "done", "no_show", "cancelled_by_customer", "cancelled_by_shop"]);
const body = z.object({ to: z.enum(["confirmed", "done", "no_show", "cancelled_by_shop"]), expected: status, purchaseAmountMinor: z.number().int().min(1).max(MAX_PURCHASE_AMOUNT_MINOR).optional(), reason: z.string().trim().max(80).optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);
    const scope = await bookingStaffScope(request);
    const { id } = await context.params;
    return Response.json(await transition({ ...scope, appointmentId: pathId(id), ...body.parse(await jsonBody(request, 1000)) }), { headers: NO_STORE });
  } catch (error) { return respondError(error); }
}
