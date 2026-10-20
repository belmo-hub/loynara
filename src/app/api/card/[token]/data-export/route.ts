import { z } from "zod";
import { jsonBody, requireSameOrigin } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { personalExportError, personalExportResponse } from "@/lib/customer-personal-export-http";
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "personal_export_download_peer", 12, 3600);
    const { token } = await context.params;
    await enforceRateLimit({ scope: "personal_export_download_card", identity: token, max: 3, windowSeconds: 3600 });
    z.object({}).strict().parse(await jsonBody(request, 256));
    return await personalExportResponse({ cardToken: token }, request);
  } catch (error) { return personalExportError(error); }
}
