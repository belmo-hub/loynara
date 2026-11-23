import { acceptBookingAvv, bookingAvvStatus } from "@/lib/booking-avv";
import { requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";

/** ENG-339: whether the business accepted the AVV Fassung with Terminbuchung; the owner accepts it here (Inhaberkonto only). */
export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_booking_avv_user", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    return Response.json(await bookingAvvStatus(user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_booking_avv_write", identity: user.id, max: 10, windowSeconds: 15 * 60 });
    return Response.json(await acceptBookingAvv(user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
