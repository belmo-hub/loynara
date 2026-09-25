import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { createStaffInvite } from "@/lib/staff";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    const body = await jsonBody(request, 3000);
    const result = await createStaffInvite({ ...(body as Record<string, unknown>), actorUserId: user.id } as Parameters<typeof createStaffInvite>[0]);
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
