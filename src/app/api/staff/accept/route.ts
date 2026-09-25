import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { acceptStaffInvite } from "@/lib/staff";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    const body = z.object({ token: z.string().min(1).max(100) }).parse(await jsonBody(request, 1000));
    return Response.json(await acceptStaffInvite({ userId: user.id, token: body.token }));
  } catch (error) { return respondError(error); }
}
