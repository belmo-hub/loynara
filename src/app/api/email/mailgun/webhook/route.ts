import { jsonBody } from "@/lib/http";
import { recordMailgunWebhook } from "@/lib/transactional-email";

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return new Response(null, { status: 406 });
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
