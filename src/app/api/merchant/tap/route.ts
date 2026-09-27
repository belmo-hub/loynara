import { z } from "zod";
import { activateSecureTag, provisionSecureTag, replaceSecureTag, revokeSecureTag, setTapPolicy } from "@/lib/secure-tap";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("policy"), programId: z.uuid(), mode: z.enum(["disabled", "automatic_fixed", "staff_confirmed"]), cooldownSeconds: z.number().int().min(1).max(86400).nullable() }).strict(),
  z.object({ action: z.literal("provision"), programId: z.uuid(), uid: z.string().regex(/^[a-f0-9]{14}$/), keyRef: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), configVersion: z.number().int().min(1) }).strict(),
  z.object({ action: z.literal("activate"), tagId: z.uuid() }).strict(),
  z.object({ action: z.literal("revoke"), tagId: z.uuid() }).strict(),
  z.object({ action: z.literal("replace"), tagId: z.uuid(), uid: z.string().regex(/^[a-f0-9]{14}$/), keyRef: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), configVersion: z.number().int().min(1) }).strict(),
]);
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "tap_admin_user", identity: user.id, max: 50, windowSeconds: 15 * 60 });
    const input = body.parse(await jsonBody(request, 1000));
    const result = input.action === "policy" ? await setTapPolicy({ actorUserId: user.id, ...input })
      : input.action === "provision" ? await provisionSecureTag({ actorUserId: user.id, ...input })
      : input.action === "activate" ? await activateSecureTag({ actorUserId: user.id, ...input })
      : input.action === "revoke" ? await revokeSecureTag({ actorUserId: user.id, ...input })
      : await replaceSecureTag({ actorUserId: user.id, ...input });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
