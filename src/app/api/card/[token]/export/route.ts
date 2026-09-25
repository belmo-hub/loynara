import { getCustomerExport } from "@/lib/export";
import { respondError } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    await enforcePeerLimit(request, "card_export_peer", 30, 60 * 60);
    const { token } = await context.params;
    await enforceRateLimit({ scope: "card_export_token", identity: token, max: 10, windowSeconds: 60 * 60 });
    return new Response(JSON.stringify(await getCustomerExport(token)), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="looplocal-card-export.json"', "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
