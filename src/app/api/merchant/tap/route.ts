import { z } from "zod";
import { programTagStatus, setTapPolicy } from "@/lib/secure-tap";
import { nfcCapability } from "@/lib/nfc-keys";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";

const body = z.object({ action: z.literal("policy"), programId: z.uuid(), mode: z.enum(["disabled", "automatic_fixed", "staff_confirmed"]), cooldownSeconds: z.number().int().min(1).max(86400).nullable() }).strict();
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "tap_admin_user", identity: user.id, max: 50, windowSeconds: 15 * 60 });
    const input = body.parse(await jsonBody(request, 1000));
    const result = await setTapPolicy({ actorUserId: user.id, programId: input.programId, mode: input.mode, cooldownSeconds: input.cooldownSeconds });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}

/** Owner view: what this deployment can do with NFC, plus the programme's tags (non-secret fields only). */
export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    const programId = z.uuid().parse(new URL(request.url).searchParams.get("programId"));
    return Response.json({ capability: nfcCapability(), ...(await programTagStatus({ actorUserId: user.id, programId })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
