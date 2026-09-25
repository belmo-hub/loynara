import { respondError, sessionUser } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { getMerchantAnalytics, type AnalyticsWindowDays } from "@/lib/merchant-analytics";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  try {
    await enforcePeerLimit(request, "merchant_analytics_peer", 120, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_analytics_user", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    const window = new URL(request.url).searchParams.get("window") ?? "30";
    if (window !== "30" && window !== "90") throw new DomainError("INVALID_WINDOW", "Choose a 30 or 90 day window");
    const report = await getMerchantAnalytics(user.id, { windowDays: Number(window) as AnalyticsWindowDays });
    return Response.json(report, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
