import { enroll } from "@/lib/product";
import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const data = await jsonBody(request, 10_000);
    const result = await enroll(data as Parameters<typeof enroll>[0]);
    return Response.json({ cardToken: result.cardToken }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
