import { getCustomerExport } from "@/lib/export";
import { respondError } from "@/lib/http";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    return new Response(JSON.stringify(await getCustomerExport((await context.params).token)), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="looplocal-card-export.json"', "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
