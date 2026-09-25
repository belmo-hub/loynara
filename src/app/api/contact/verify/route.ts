import { z } from "zod";
import { consumeContactVerification } from "@/lib/contact-verification";
import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";
import { enforcePeerLimit } from "@/lib/rate-limit";

const inputSchema = z.object({ token: z.string().min(40).max(100) }).strict();

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "contact_verify_peer", 30, 60 * 60);
    const { token } = inputSchema.parse(await jsonBody(request, 1000));
    return Response.json(await consumeContactVerification(token), { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return respondError(error); }
}
