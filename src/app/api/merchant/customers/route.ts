import { respondError, sessionUser } from "@/lib/http";
import { listMerchantMembers } from "@/lib/merchant-members";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  try {
    await enforcePeerLimit(request, "merchant_customer_list_peer", 240, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_customer_list_user", identity: user.id, max: 120, windowSeconds: 15 * 60 });
    const query = new URL(request.url).searchParams;
    const result = await listMerchantMembers(user.id, {
      query: query.get("q") ?? undefined,
      status: (query.get("status") ?? undefined) as "all" | "active" | "closed" | undefined,
      activity: (query.get("activity") ?? undefined) as "all" | "recorded" | "none" | undefined,
      cursor: query.get("cursor") ?? undefined,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
