import { jsonBody } from "@/lib/http";
import { enforcePeerLimit, RateLimitError } from "@/lib/rate-limit";
import { recordMailgunWebhook } from "@/lib/transactional-email";

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return new Response(null, { status: 406 });
  try { await enforcePeerLimit(request, "mailgun_webhook", 60, 60); }
  catch (error) { return new Response(null, { status: error instanceof RateLimitError ? 429 : 503, headers: { "Cache-Control": "no-store" } }); }
  let body: unknown;
  try { body = await jsonBody(request, 32_000); } catch { return new Response(null, { status: 406 }); }
  try {
    const result = await recordMailgunWebhook(body);
    return new Response(null, { status: result.accepted ? 200 : 406 });
  } catch {
    // Mailgun retries processing failures. Do not log a body containing addresses.
    return new Response(null, { status: 503 });
  }
}
