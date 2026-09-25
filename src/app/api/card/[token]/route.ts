import { getCard } from "@/lib/product";
import { respondError } from "@/lib/http";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try { return Response.json(await getCard((await context.params).token), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }); }
  catch (error) { return respondError(error); }
}
