import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const host = request.headers.get("host")?.toLowerCase().replace(/:443$/, "");
  let unsubscribeHost: string | undefined;
  try { unsubscribeHost = new URL(process.env.PROMOTIONAL_UNSUBSCRIBE_ORIGIN ?? "").host.toLowerCase(); } catch { /* No public unsubscribe host configured. */ }
  if (host === "mail-events.getloynara.com"
    && (request.method !== "POST" || request.nextUrl.pathname !== "/api/email/mailgun/webhook")) {
    return new NextResponse(null, { status: 404, headers: { "cache-control": "no-store" } });
  }
  if (unsubscribeHost && host === unsubscribeHost) {
    const path = request.nextUrl.pathname;
    const allowed = (request.method === "GET" && (path === "/unsubscribe" || path === "/icon.svg" || path.startsWith("/_next/static/")))
      || (request.method === "POST" && path === "/api/unsubscribe");
    if (!allowed) return new NextResponse(null, { status: 404, headers: { "cache-control": "no-store" } });
  }
  return NextResponse.next();
}
