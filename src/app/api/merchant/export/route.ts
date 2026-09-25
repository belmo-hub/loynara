import { getMerchantExport } from "@/lib/export";
import { respondError, sessionUser } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    return new Response(JSON.stringify(await getMerchantExport(user.id)), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="looplocal-merchant-export.json"', "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
