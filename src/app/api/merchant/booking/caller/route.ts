import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";
import { bookingStaffScope, callerLookup, NO_STORE, ownerBook } from "@/lib/booking/appointments";

// ENG-372: the shop enters a caller's appointment, only for a card found by its number (owner and manager, as the day view).
const card = z.string().trim().min(1).max(40);
const body = z.object({ card, serviceId: z.uuid(), staffId: z.uuid(), start: z.iso.datetime(), customerName: z.string().trim().min(1).max(60), idempotencyKey: z.string().min(8).max(100) }).strict();

export async function GET(request: Request) {
  try {
    const scope = await bookingStaffScope(request);
    return Response.json(await callerLookup(scope, card.parse(new URL(request.url).searchParams.get("card"))), { headers: NO_STORE });
  } catch (error) { return respondError(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const { tenantId, locationId } = await bookingStaffScope(request);
    const input = body.parse(await jsonBody(request, 1000));
    const { appointment, duplicate } = await ownerBook({ tenantId, locationId, cardNumber: input.card, serviceId: input.serviceId, staffId: input.staffId, start: new Date(input.start), customerName: input.customerName, idempotencyKey: input.idempotencyKey });
    return Response.json(appointment, { status: duplicate ? 200 : 201, headers: NO_STORE });
  } catch (error) { return respondError(error); }
}
