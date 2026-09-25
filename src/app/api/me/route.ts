import { getMerchantContext } from "@/lib/product";
import { respondError, sessionUser } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    const context = await getMerchantContext(user.id);
    return Response.json(context ?? { userId: user.id, tenantId: null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
