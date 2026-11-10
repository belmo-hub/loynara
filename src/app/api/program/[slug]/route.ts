import { getPublicProgram } from "@/lib/product";
import { respondError } from "@/lib/http";
import { enforcePeerLimit } from "@/lib/rate-limit";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    // Public, so per address only (a shared per-programme limit could be used up to block a join page); as card reads.
    await enforcePeerLimit(request, "program_read_peer", 240, 15 * 60);
    return Response.json(await getPublicProgram((await context.params).slug), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
