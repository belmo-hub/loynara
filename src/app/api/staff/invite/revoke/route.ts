import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { revokeStaffInvite } from "@/lib/staff";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    const body = z.object({ inviteId: z.uuid() }).parse(await jsonBody(request, 1000));
    return Response.json(await revokeStaffInvite({ actorUserId: user.id, inviteId: body.inviteId }),
      { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
