import { randomUUID } from "node:crypto";
import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { DomainError, reverseEntry } from "@/lib/loyalty";
import { selectedLocationFromRequest } from "@/lib/locations";
import { getMerchantContext } from "@/lib/product";

const input = z.object({ locationId: z.uuid(), entryId: z.uuid(), reason: z.string().trim().min(10).max(240), idempotencyKey: z.string().min(8).max(100) });

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    const body = input.parse(await jsonBody(request, 2000));
    const context = await getMerchantContext(user.id, selectedLocationFromRequest(request, user.id));
    if (!context || context.locationId !== body.locationId) throw new DomainError("NOT_FOUND", "Transaction not found at selected location");
    return Response.json(await reverseEntry({ ...body, userId: user.id, requestId: randomUUID() }));
  } catch (error) { return respondError(error); }
}
