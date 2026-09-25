import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { updateProgram } from "@/lib/product";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    const body = await jsonBody(request, 5000);
    return Response.json(await updateProgram({ ...(body as Record<string, unknown>), actorUserId: user.id } as Parameters<typeof updateProgram>[0]));
  } catch (error) { return respondError(error); }
}
