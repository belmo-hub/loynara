import { z } from "zod";
import { listAutomations, upsertAutomationRule } from "@/lib/automations";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

const input = z.object({
  programSlug: z.string().min(1).max(120), triggerKind: z.enum(["first_checkout", "inactive"]),
  enabled: z.boolean(), subject: z.string().min(2).max(120), body: z.string().min(5).max(3000),
  inactivityDays: z.number().int().min(7).max(365).optional(),
  cooldownDays: z.number().int().min(7).max(365), dailyCap: z.number().int().min(1).max(20),
}).strict();
const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function GET(request: Request) {
  try {
    await enforcePeerLimit(request, "merchant_automations_list_peer", 120, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_automations_list_user", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    const programSlug = new URL(request.url).searchParams.get("programSlug");
    if (!programSlug) return Response.json({ error: "Missing programme" }, { status: 400, headers: noStore });
    return Response.json(await listAutomations({ actorUserId: user.id, programSlug }), { headers: noStore });
  } catch (error) { return respondError(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "merchant_automations_mutation_peer", 60, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_automations_mutation_user", identity: user.id, max: 30, windowSeconds: 15 * 60 });
    const body = input.parse(await jsonBody(request, 6000));
    return Response.json({ rule: await upsertAutomationRule({ actorUserId: user.id, ...body }) }, { headers: noStore });
  } catch (error) { return respondError(error); }
}
