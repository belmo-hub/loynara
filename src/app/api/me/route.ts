import { getMerchantContext } from "@/lib/product";
import { respondError, sessionUser } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    const context = await getMerchantContext(user.id);
    const publicBaseUrl = process.env.PUBLIC_BASE_URL;
    if (!publicBaseUrl || new URL(publicBaseUrl).origin !== publicBaseUrl) throw new Error("Public application origin is not configured");
    return Response.json({ ...(context ?? { userId: user.id, tenantId: null }), publicBaseUrl }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
