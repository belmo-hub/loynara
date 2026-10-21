import { db } from "@/db";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { assertPlateOperator, setPlateLink } from "@/lib/plates";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

/** Link, relink or unlink one plate (programmeId null = unlink). `execute` false is the dry run that shows from → to. */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "operator_plate_peer", 60, 15 * 60);
    const user = await sessionUser(request);
    // Before the limiter and the body: a non-operator learns nothing from a 400 or a 429.
    await db.transaction(tx => assertPlateOperator(tx, user.id, process.env));
    await enforceRateLimit({ scope: "operator_plate_user", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    const body = await jsonBody(request, 2000) as { plateLabel?: unknown; programId?: unknown; execute?: unknown };
    if (typeof body.plateLabel !== "string" || (body.programId !== null && typeof body.programId !== "string") || typeof body.execute !== "boolean") throw new DomainError("INVALID_INPUT", "Invalid input");
    const result = await setPlateLink({ actorUserId: user.id, env: process.env, plateLabel: body.plateLabel, programId: body.programId, execute: body.execute });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Anyone who is not the operator gets the same empty 404 as the page: the route does not admit it exists.
    if (error instanceof DomainError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN" || error.code === "INVALID_ORIGIN")) return notFound();
    return respondError(error);
  }
}
