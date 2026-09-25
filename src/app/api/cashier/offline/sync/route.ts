import { z } from "zod";
import { syncOfflineAward } from "@/lib/offline-earning";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

const award = z.union([
  z.object({ quantity: z.number().int().min(1).max(1000) }).strict(),
  z.object({ purchaseAmountMinor: z.number().int().min(1).max(1_000_000), ruleVersionId: z.uuid() }).strict(),
]);
const body = z.object({ leaseId: z.uuid(), deviceId: z.uuid(), eventId: z.uuid(), eventAt: z.iso.datetime(), award }).strict();

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "offline_sync_peer", 120, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "offline_sync_user", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    const input = body.parse(await jsonBody(request, 1500));
    return Response.json(await syncOfflineAward({ ...input, userId: user.id, eventAt: new Date(input.eventAt) }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
