import { db } from "@/db";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { assertPlateOperator } from "@/lib/plates";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { setWalletTemplate } from "@/lib/wallet/template-bindings";

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

/** Sets or changes one location's Apple Wallet template. `execute` false is the dry run that shows from → to. Same gate as the plate route. */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "operator_wallet_template_peer", 60, 15 * 60);
    const user = await sessionUser(request);
    // Before the limiter and the body: a non-operator learns nothing from a 400 or a 429.
    await db.transaction(tx => assertPlateOperator(tx, user.id, process.env));
    await enforceRateLimit({ scope: "operator_wallet_template_user", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    const body = await jsonBody(request, 2000) as { tenantId?: unknown; locationId?: unknown; templateId?: unknown; execute?: unknown };
    if (typeof body.tenantId !== "string" || typeof body.locationId !== "string" || typeof body.templateId !== "string" || typeof body.execute !== "boolean") throw new DomainError("INVALID_INPUT", "Invalid input");
    const result = await setWalletTemplate({ actorUserId: user.id, env: process.env, tenantId: body.tenantId, locationId: body.locationId, templateId: body.templateId, execute: body.execute });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DomainError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN" || error.code === "INVALID_ORIGIN")) return notFound();
    return respondError(error);
  }
}
