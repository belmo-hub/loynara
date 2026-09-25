import { createMerchant } from "@/lib/product";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    const data = await jsonBody(request);
    if (!data || typeof data !== "object") return Response.json({ error: "Invalid input" }, { status: 400 });
    const result = await createMerchant({ ...data, userId: user.id } as Parameters<typeof createMerchant>[0]);
    return Response.json(result, { status: 201 });
  } catch (error) { return respondError(error); }
}
