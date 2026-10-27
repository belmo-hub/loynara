import { z } from "zod";
import { jsonBody, respondError } from "@/lib/http";
import { book, cardBookingLimits, NO_STORE } from "@/lib/booking/appointments";

const body = z.object({
  serviceId: z.uuid(), staffId: z.uuid().optional(), start: z.iso.datetime(), customerName: z.string().trim().min(1).max(60),
  customerPhone: z.string().trim().max(30).optional(), idempotencyKey: z.string().min(8).max(100), rebookSourceId: z.uuid().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    await cardBookingLimits(request, token, true);
    const input = body.parse(await jsonBody(request, 2000));
    const { appointment, duplicate } = await book({ ...input, token, start: new Date(input.start), customerPhone: input.customerPhone || undefined });
    return Response.json(appointment, { status: duplicate ? 200 : 201, headers: NO_STORE });
  } catch (error) { return respondError(error); }
}
