import { z } from "zod";
import { jsonBody, requireSameOrigin } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { personalExportError, personalExportResponse } from "@/lib/customer-personal-export-http";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "personal_export_proof_peer", 12, 3600);
    const { proof } = z.object({ proof: z.string().regex(/^e_[A-Za-z0-9_-]{43}$/) }).strict().parse(await jsonBody(request, 256));
    await enforceRateLimit({ scope: "personal_export_proof", identity: proof, max: 3, windowSeconds: 3600 });
    return await personalExportResponse({ proof }, request);
  } catch (error) { return personalExportError(error); }
}
