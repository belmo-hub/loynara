import { enforcePeerLimit } from "@/lib/rate-limit";
import { reportLines } from "./report";

const MAX_BYTES = 16_384;

/** The Reporting API's CSP endpoint (next.config.ts). Answers 204 to anything; a report it cannot read is dropped. */
export async function POST(request: Request) {
  try {
    await enforcePeerLimit(request, "csp_report_peer", 60, 15 * 60);
    const type = request.headers.get("content-type") ?? "";
    if (!type.startsWith("application/reports+json") && !type.startsWith("application/csp-report")) return new Response(null, { status: 204 });
    if (Number(request.headers.get("content-length")) > MAX_BYTES) return new Response(null, { status: 204 });
    const text = await request.text();
    if (text.length > MAX_BYTES) return new Response(null, { status: 204 });
    for (const line of reportLines(JSON.parse(text))) console.warn(line);
  } catch { /* limited, oversized or unreadable: nothing to log */ }
  return new Response(null, { status: 204 });
}
