import { getMarketingPreference, withdrawMarketingConsent } from "@/lib/email";
import { requireSameOrigin, respondError } from "@/lib/http";

type Context = { params: Promise<{ token: string }> };
const privateHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function GET(_request: Request, context: Context) {
  try {
    return Response.json(await getMarketingPreference((await context.params).token), { headers: privateHeaders });
  } catch (error) { return respondError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    requireSameOrigin(request);
    await withdrawMarketingConsent((await context.params).token);
    return Response.json({ marketingEmail: false }, { headers: privateHeaders });
  } catch (error) { return respondError(error); }
}
