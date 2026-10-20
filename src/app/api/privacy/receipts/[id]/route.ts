import { deletionReceipt } from "@/lib/merchant-deletion";
import { respondError } from "@/lib/http";
import { enforcePeerLimit } from "@/lib/rate-limit";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await enforcePeerLimit(request, "deletion_receipt_peer", 30, 3600);
    const { id } = await context.params;
    return Response.json(await deletionReceipt(id), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
