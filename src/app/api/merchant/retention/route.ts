import { respondError, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { getRetentionSummary, parseRetentionDays } from "@/lib/retention";

export async function GET(request: Request) {
  try {
    await enforcePeerLimit(request, "merchant_retention_peer", 120, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_retention_user", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    const params = new URL(request.url).searchParams;
    const summary = await getRetentionSummary(user.id, { inactiveDays: parseRetentionDays(params.get("days")), locationId: params.get("locationId") || null });
    return Response.json(summary, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
