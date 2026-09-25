import { getPublicProgram } from "@/lib/product";
import { respondError } from "@/lib/http";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  try { return Response.json(await getPublicProgram((await context.params).slug), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return respondError(error); }
}
