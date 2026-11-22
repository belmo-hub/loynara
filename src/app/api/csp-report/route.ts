import { jsonBody } from "@/lib/http";
import { enforcePeerLimit } from "@/lib/rate-limit";
import { reportLines } from "./report";

const MAX_BYTES = 16_384;
// The Reporting API sends application/reports+json; report-uri sends application/csp-report.
const REPORT_TYPES = ["application/reports+json", "application/csp-report"] as const;

/** The CSP report endpoint (next.config.ts). Answers 204 to anything; a report it cannot read is dropped. The body is
 *  read through the capped streaming reader, so an oversized one is cut off at 16 KB whatever Content-Length says. */
export async function POST(request: Request) {
  try {
    await enforcePeerLimit(request, "csp_report_peer", 60, 15 * 60);
    for (const line of reportLines(await jsonBody(request, MAX_BYTES, REPORT_TYPES))) console.warn(line);
  } catch { /* limited, oversized, wrong type or unreadable: nothing to log */ }
  return new Response(null, { status: 204 });
}
