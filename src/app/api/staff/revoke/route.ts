import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { revokeStaff } from "@/lib/staff";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    const body = z.object({ userId: z.string().min(1) }).parse(await jsonBody(request, 1000));
    return Response.json(await revokeStaff({ actorUserId: user.id, userId: body.userId }));
  } catch (error) { return respondError(error); }
}
