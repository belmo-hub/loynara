import { z } from "zod";
import { brandUpdateSchema, getMerchantBrand, updateMerchantBrand } from "@/lib/merchant-brand";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

const slugSchema = z.string().min(1).max(120);
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function GET(request: Request) {
  try {
    await enforcePeerLimit(request, "merchant_brand_read_peer", 100, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_brand_read_user", identity: user.id, max: 50, windowSeconds: 15 * 60 });
    const programSlug = slugSchema.parse(new URL(request.url).searchParams.get("programSlug"));
    return Response.json(await getMerchantBrand({ actorUserId: user.id, programSlug }), { headers });
  } catch (error) { return respondError(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "merchant_brand_write_peer", 30, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_brand_write_user", identity: user.id, max: 15, windowSeconds: 15 * 60 });
    const input = brandUpdateSchema.parse(await jsonBody(request, 3_100_000));
    return Response.json(await updateMerchantBrand({ ...input, actorUserId: user.id }), { headers });
  } catch (error) { return respondError(error); }
}
