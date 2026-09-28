import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const host = request.headers.get("host")?.toLowerCase().replace(/:443$/, "");
  if (host === "mail-events.getloynara.com"
    && (request.method !== "POST" || request.nextUrl.pathname !== "/api/email/mailgun/webhook")) {
    return new NextResponse(null, { status: 404, headers: { "cache-control": "no-store" } });
  }
  return NextResponse.next();
}
