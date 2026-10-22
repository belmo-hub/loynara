import { db } from "@/db";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { createShopWithOwnerInvite, reissueOwnerInvite, revokeOwnerInvite } from "@/lib/owner-invites";
import { assertPlateOperator } from "@/lib/plates";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * Creates a shop with a one-time owner invitation, issues a new one, or revokes one. Same gate as the plate route.
 * The answer carries the invitation link once; it is not stored and not logged.
 */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "operator_shop_peer", 30, 15 * 60);
    const user = await sessionUser(request);
    // Before the limiter and the body: a non-operator learns nothing from a 400 or a 429.
    await db.transaction(tx => assertPlateOperator(tx, user.id, process.env));
    await enforceRateLimit({ scope: "operator_shop_user", identity: user.id, max: 30, windowSeconds: 15 * 60 });
    const body = await jsonBody(request, 3000) as Record<string, unknown>;
    const actor = { actorUserId: user.id, env: process.env };
    const linked = (result: { token: string; inviteId: string; tenantId: string; expiresAt: Date; email: string }) => {
      const { token, ...rest } = result;
      return Response.json({ ...rest, link: new URL(`/invite/${token}`, process.env.PUBLIC_BASE_URL).href }, { status: 201, headers: { "Cache-Control": "no-store" } });
    };
    if (body.action === "create") return linked(await createShopWithOwnerInvite({ ...actor, shop: body }));
    if (body.action === "reissue") return linked(await reissueOwnerInvite({ ...actor, tenantId: String(body.tenantId ?? ""), ownerEmail: String(body.ownerEmail ?? "") }));
    if (body.action === "revoke") return Response.json(await revokeOwnerInvite({ ...actor, inviteId: String(body.inviteId ?? "") }), { headers: { "Cache-Control": "no-store" } });
    throw new DomainError("INVALID_INPUT", "Invalid input");
  } catch (error) {
    // Anyone who is not the operator gets the same empty 404 as the page: the route does not admit it exists.
    if (error instanceof DomainError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN" || error.code === "INVALID_ORIGIN")) return notFound();
    return respondError(error);
  }
}
