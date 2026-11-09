import { db } from "@/db";
import { createDemo } from "@/lib/demo";
import { demoEnvironment } from "@/lib/demo-environment";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { assertPlateOperator } from "@/lib/plates";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

/** „Demo starten“ / „Neu starten“ (demo-mode design v3). Same gate as the other operator routes; outside the demo environment it does not exist. */
export async function POST(request: Request) {
  try {
    if (!demoEnvironment()) return notFound();
    requireSameOrigin(request);
    await enforcePeerLimit(request, "operator_demo_peer", 60, 15 * 60);
    const user = await sessionUser(request);
    // Before the limiter and the body: a non-operator learns nothing from a 400 or a 429.
    await db.transaction(tx => assertPlateOperator(tx, user.id, process.env));
    await enforceRateLimit({ scope: "operator_demo_user", identity: user.id, max: 30, windowSeconds: 15 * 60 });
    // The logo comes as a data URL, as in the setup (same limit as the onboard route).
    const body = await jsonBody(request) as Record<string, unknown>;
    if (!body || typeof body !== "object") throw new DomainError("INVALID_INPUT", "Bitte prüfe deine Eingaben und versuche es noch einmal.");
    return Response.json(await createDemo({ actorUserId: user.id, env: process.env, key: body.key, templateId: body.templateId, businessName: body.businessName, logoData: body.logoData, brandColor: body.brandColor, rewardTitle: body.rewardTitle, rewardCost: body.rewardCost }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DomainError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN" || error.code === "INVALID_ORIGIN")) return notFound();
    return respondError(error);
  }
}
