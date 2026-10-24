import { respondError, sessionUser } from "@/lib/http";
import { getLocationAnalytics } from "@/lib/merchant-analytics";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  try {
    await enforcePeerLimit(request, "merchant_location_analytics_peer", 120, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_location_analytics_user", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    const report = await getLocationAnalytics(user.id, { locationId: new URL(request.url).searchParams.get("locationId") ?? "" });
    return Response.json(report, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
