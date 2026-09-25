import { queueMarketingEmail } from "@/lib/email";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    const data = await jsonBody(request, 5000);
    if (!data || typeof data !== "object") return Response.json({ error: "Invalid input" }, { status: 400 });
    const job = await queueMarketingEmail({ ...data, userId: user.id } as Parameters<typeof queueMarketingEmail>[0]);
    return Response.json({ jobId: job.id, status: job.status, delivery: "mailpit_local_only" }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
