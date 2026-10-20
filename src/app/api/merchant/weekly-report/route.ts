import { z } from "zod";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getWeeklyReportSetting, setWeeklyReportSetting } from "@/lib/weekly-owner-report";

const input = z.object({ enabled: z.boolean() }).strict();

export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_weekly_report_user", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    return Response.json(await getWeeklyReportSetting(user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_weekly_report_write", identity: user.id, max: 30, windowSeconds: 15 * 60 });
    const { enabled } = input.parse(await jsonBody(request, 200));
    return Response.json(await setWeeklyReportSetting(user.id, enabled), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
