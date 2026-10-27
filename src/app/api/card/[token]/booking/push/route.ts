import { z } from "zod";
import { jsonBody, respondError } from "@/lib/http";
import { cardBookingLimits, NO_STORE } from "@/lib/booking/appointments";
import { deleteCustomerPushSubscription, saveCustomerPushSubscription } from "@/lib/booking/notify";

type Context = { params: Promise<{ token: string }> };

/** This browser gets reminders for the card; the subscription is validated like a staff device's (known push services only). */
export async function POST(request: Request, context: Context) {
  try {
    const { token } = await context.params;
    await cardBookingLimits(request, token, true);
    const body = z.object({ subscription: z.unknown() }).parse(await jsonBody(request, 4_000));
    await saveCustomerPushSubscription(token, body.subscription);
    return new Response(null, { status: 204, headers: NO_STORE });
  } catch (error) { return respondError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { token } = await context.params;
    await cardBookingLimits(request, token, true);
    const body = z.object({ endpoint: z.string().max(1000) }).parse(await jsonBody(request, 2_000));
    await deleteCustomerPushSubscription(token, body.endpoint);
    return new Response(null, { status: 204, headers: NO_STORE });
  } catch (error) { return respondError(error); }
}
