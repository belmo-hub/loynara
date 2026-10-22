import { db } from "@/db";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { issuePlateCodes, unlockPlateCode } from "@/lib/plate-activation";
import { assertPlateOperator } from "@/lib/plates";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

/** Issues activation codes for a batch of free plates (shown once, for printing), or unlocks a locked one. Same gate as the plate route. */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "operator_codes_peer", 30, 15 * 60);
    const user = await sessionUser(request);
    // Before the limiter and the body: a non-operator learns nothing from a 400 or a 429.
    await db.transaction(tx => assertPlateOperator(tx, user.id, process.env));
    await enforceRateLimit({ scope: "operator_codes_user", identity: user.id, max: 30, windowSeconds: 15 * 60 });
    const body = await jsonBody(request, 8000) as { action?: unknown; plateLabels?: unknown; plateLabel?: unknown };
    const actor = { actorUserId: user.id, env: process.env };
    if (body.action === "issue" && Array.isArray(body.plateLabels) && body.plateLabels.every(label => typeof label === "string")) {
      return Response.json({ codes: await issuePlateCodes({ ...actor, plateLabels: body.plateLabels }) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "unlock" && typeof body.plateLabel === "string") return Response.json(await unlockPlateCode({ ...actor, plateLabel: body.plateLabel }), { headers: { "Cache-Control": "no-store" } });
    throw new DomainError("INVALID_INPUT", "Invalid input");
  } catch (error) {
    // Anyone who is not the operator gets the same empty 404 as the page: the route does not admit it exists.
    if (error instanceof DomainError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN" || error.code === "INVALID_ORIGIN")) return notFound();
    return respondError(error);
  }
}
