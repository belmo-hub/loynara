import { z } from "zod";
import { jsonBody, respondError } from "@/lib/http";
import { cardBookingLimits, NO_STORE } from "@/lib/booking/appointments";
import { setRebookConsent } from "@/lib/booking/notify";

/** The rebook push opt-in (marketing, unticked by default); each change is a consent_events row, the newest one counts. */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    await cardBookingLimits(request, token, true);
    const body = z.object({ rebook: z.boolean() }).strict().parse(await jsonBody(request, 500));
    await setRebookConsent(token, body.rebook);
    return new Response(null, { status: 204, headers: NO_STORE });
  } catch (error) { return respondError(error); }
}
