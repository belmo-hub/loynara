import QRCode from "qrcode";

export async function GET(request: Request) {
  const value = new URL(request.url).searchParams.get("value") ?? "";
  const sameOriginJoin = value.startsWith(`${new URL(request.url).origin}/join/`) && value.length < 300;
  if (!value.startsWith("sc_") && !sameOriginJoin) return Response.json({ error: "Invalid QR content" }, { status: 400 });
  const svg = await QRCode.toString(value, { type: "svg", margin: 1, width: 320, errorCorrectionLevel: "M" });
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
