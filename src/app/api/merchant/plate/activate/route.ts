import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { activatePlate } from "@/lib/plate-activation";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

const body = z.object({ programId: z.uuid(), plateLabel: z.string().max(32), code: z.string().max(40) }).strict();

/** The owner links a mailed plate to the current programme with the code from its box. */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "plate_activate_peer", 30, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "plate_activate_user", identity: user.id, max: 10, windowSeconds: 15 * 60 });
    const input = body.parse(await jsonBody(request, 1000));
    // Counted for any label, known or not, so the limit says nothing about which plates exist.
    await enforceRateLimit({ scope: "plate_activate_plate", identity: input.plateLabel.trim().toUpperCase() || "-", max: 10, windowSeconds: 60 * 60 });
    return Response.json(await activatePlate({ userId: user.id, ...input }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
