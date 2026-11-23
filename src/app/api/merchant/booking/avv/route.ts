import { acceptBookingAvv } from "@/lib/booking-avv";
import { requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";

/** ENG-339: the owner accepts the terms and AVV Fassung with „Termin + Treue“ (Inhaberkonto only); /api/me says whether they did. */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_booking_avv_write", identity: user.id, max: 10, windowSeconds: 15 * 60 });
    return Response.json(await acceptBookingAvv(user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
