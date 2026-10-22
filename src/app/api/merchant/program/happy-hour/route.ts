import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { updateProgramHappyHour } from "@/lib/product";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_program_happy_hour_write", identity: user.id, max: 30, windowSeconds: 15 * 60 });
    const body = await jsonBody(request, 4000);
    return Response.json(await updateProgramHappyHour({ ...(body as Record<string, unknown>), actorUserId: user.id } as Parameters<typeof updateProgramHappyHour>[0]), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
