import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";
import { blockCustomer, bookingStaffScope, pathId } from "@/lib/booking/appointments";

const body = z.object({ reason: z.string().trim().max(80).optional() });

export async function POST(request: Request, context: { params: Promise<{ membershipId: string }> }) {
  try {
    requireSameOrigin(request);
    const scope = await bookingStaffScope(request);
    const { membershipId } = await context.params;
    await blockCustomer({ ...scope, membershipId: pathId(membershipId), ...body.parse(await jsonBody(request, 1000)) });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
