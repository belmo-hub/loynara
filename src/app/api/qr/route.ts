import QRCode from "qrcode";
import { respondError } from "@/lib/http";
import { enforcePeerLimit } from "@/lib/rate-limit";

const scanCode = /^sc_[A-Za-z0-9_-]{32}$/;
const joinPath = /^\/join\/[a-z0-9-]{1,120}$/;

function validJoinUrl(value: string, request: Request): boolean {
  if (value.length > 300) return false;
  try {
    const target = new URL(value);
    const publicOrigin = new URL(process.env.PUBLIC_BASE_URL ?? request.url).origin;
    return target.origin === publicOrigin && joinPath.test(target.pathname)
      && !target.search && !target.hash && !target.username && !target.password;
  } catch { return false; }
}

export async function GET(request: Request) {
  try {
    const value = new URL(request.url).searchParams.get("value") ?? "";
    if (!scanCode.test(value) && !validJoinUrl(value, request)) return Response.json({ error: "Invalid QR content" }, { status: 400 });
    await enforcePeerLimit(request, "qr_render_peer", 240, 15 * 60);
    const svg = await QRCode.toString(value, { type: "svg", margin: 1, width: 320, errorCorrectionLevel: "M" });
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return respondError(error); }
}
