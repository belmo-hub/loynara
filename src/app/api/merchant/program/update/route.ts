import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { takeBackRuleChange, updateProgram } from "@/lib/product";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    const body = await jsonBody(request, 5000);
    const input: Record<string, unknown> = { ...(body as Record<string, unknown>), actorUserId: user.id };
    // ENG-100 „Änderung zurücknehmen“ for the rule or the expiry: { programSlug, takeBack: true }.
    if (input.takeBack === true) return Response.json(await takeBackRuleChange(input as Parameters<typeof takeBackRuleChange>[0]));
    return Response.json(await updateProgram(input as Parameters<typeof updateProgram>[0]));
  } catch (error) { return respondError(error); }
}
