import { z } from "zod";
import { jsonBody, respondError } from "@/lib/http";
import { requireAdmin } from "@/lib/admin/guard";
import { resetAdminSecondFactor } from "@/lib/admin/admins";
const inputSchema = z.object({ idempotencyKey: z.string().uuid() }).strict();
export async function POST(request: Request, context: { params: Promise<{ userId: string }> }) {
  try {
    const ctx = await requireAdmin(request, "admins.reset_2fa");
    const { userId } = await context.params;
    const targetUserId = z.string().min(1).max(120).parse(userId);
    const { idempotencyKey } = inputSchema.parse(await jsonBody(request, 4096));
    await resetAdminSecondFactor({ targetUserId, by: { actor: "console", ctx, idempotencyKey } });
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) { const response = respondError(error); response.headers.set("cache-control", "no-store"); return response; }
}
