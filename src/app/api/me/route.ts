import { DomainError } from "@/lib/loyalty";
import { endedAccount } from "@/lib/programme-end";
import { getMerchantContext } from "@/lib/product";
import { respondError, sessionUser } from "@/lib/http";
import { selectedLocationFromRequest } from "@/lib/locations";

export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    const publicBaseUrl = process.env.PUBLIC_BASE_URL;
    if (!publicBaseUrl || new URL(publicBaseUrl).origin !== publicBaseUrl) throw new Error("Public application origin is not configured");
    let context;
    try { context = await getMerchantContext(user.id, selectedLocationFromRequest(request, user.id)); }
    catch (error) {
      // A shop whose programme has ended can still log in: the owner area is then only the export (30 days).
      const ended = error instanceof DomainError && error.code === "PROGRAM_ENDED" ? await endedAccount(user.id) : null;
      if (!ended) throw error;
      const { tenantId, ...programEnded } = ended;
      return Response.json({ userId: user.id, tenantId, programEnded, publicBaseUrl }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ ...(context ?? { userId: user.id, tenantId: null }), publicBaseUrl }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
