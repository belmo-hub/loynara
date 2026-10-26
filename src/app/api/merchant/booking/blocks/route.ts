import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";
import { bookingStaffScope, createBlock, NO_STORE } from "@/lib/booking/appointments";

const body = z.object({ staffId: z.uuid().optional(), start: z.iso.datetime(), end: z.iso.datetime(), reason: z.string().trim().max(80).default("") })
  .refine(b => Date.parse(b.end) > Date.parse(b.start), "End must be after start");

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const { tenantId, locationId } = await bookingStaffScope(request);
    const input = body.parse(await jsonBody(request, 1000));
    return Response.json(await createBlock({ tenantId, locationId, staffId: input.staffId, start: new Date(input.start), end: new Date(input.end), reason: input.reason }), { status: 201, headers: NO_STORE });
  } catch (error) { return respondError(error); }
}
