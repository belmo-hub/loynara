import { z } from "zod";
import { jsonBody, respondError } from "@/lib/http";
import { requireAdmin } from "@/lib/admin/guard";
import { performStepUp } from "@/lib/admin/session";
const inputSchema = z.object({ password: z.string().min(1).max(128), code: z.string().regex(/^\d{6}$/) }).strict();
export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin(request, "home.view");
    const input = inputSchema.parse(await jsonBody(request, 4096));
    await performStepUp({ ...ctx, ...input, ip: process.env.TRUSTED_INGRESS === "cloudflare_tunnel" ? request.headers.get("cf-connecting-ip") : null, userAgent: request.headers.get("user-agent") });
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) { const response = respondError(error); response.headers.set("cache-control", "no-store"); return response; }
}
