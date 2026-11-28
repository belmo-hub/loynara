import { validCardToken } from "@/lib/card-lifecycle";

/** One manifest per card, so a Home-Screen install opens this card; on iOS that install is the only way Web Push reaches the customer. */
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!validCardToken(token)) return new Response("Not found", { status: 404 });
  const url = `/card/${encodeURIComponent(token)}`;
  return Response.json({ name: "Loynara Karte", short_name: "Karte", lang: "de", start_url: url, scope: url, display: "standalone", background_color: "#eef0ef", theme_color: "#214739",
    icons: [{ src: "/card-icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/card-icon-512.png", sizes: "512x512", type: "image/png" }] },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
