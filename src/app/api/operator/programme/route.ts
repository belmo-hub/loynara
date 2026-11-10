import { db } from "@/db";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { assertPlateOperator } from "@/lib/plates";
import { operatorProgramme } from "@/lib/programme-end";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * Keeps or moves a business's end date (a later end needs `consent`, the shop's agreement in text form), enters an e-mailed
 * cancellation (`receivedAt`), or withdraws one. `execute` false is the dry run that shows from → to. Same gate as the plate route.
 */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "operator_programme_peer", 60, 15 * 60);
    const user = await sessionUser(request);
    // Before the limiter and the body: a non-operator learns nothing from a 400 or a 429.
    await db.transaction(tx => assertPlateOperator(tx, user.id, process.env));
    await enforceRateLimit({ scope: "operator_programme_user", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    const body = await jsonBody(request, 2000) as { programId?: unknown; command?: unknown; endDate?: unknown; receivedAt?: unknown; consent?: unknown; acceptLateEntry?: unknown; execute?: unknown };
    const command = body.command ?? "schedule";
    const valid = typeof body.programId === "string" && typeof body.execute === "boolean" && (body.consent === undefined || typeof body.consent === "boolean")
      && ((command === "schedule" && typeof body.endDate === "string") || (command === "request" && typeof body.receivedAt === "string") || command === "withdraw");
    if (!valid) throw new DomainError("INVALID_INPUT", "Bitte prüfe deine Eingaben und versuche es noch einmal.");
    const result = await operatorProgramme({ actorUserId: user.id, env: process.env, programId: body.programId as string, command: command as "schedule" | "request" | "withdraw",
      endDate: typeof body.endDate === "string" ? body.endDate : undefined, receivedAt: typeof body.receivedAt === "string" ? body.receivedAt : undefined, consent: body.consent === true, acceptLateEntry: body.acceptLateEntry === true, execute: body.execute as boolean });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DomainError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN" || error.code === "INVALID_ORIGIN")) return notFound();
    return respondError(error);
  }
}
