import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { locations, programs, tenants } from "@/db/schema";
import { enforcePeerLimit, InvalidIngressError, RateLimitError } from "@/lib/rate-limit";
import { approvedGoogleAssetOrigin, googleLogoAsset } from "./logo";

// Disabled until the operator approves a narrow provider-facing HTTPS asset route. Browser pages and card tokens need no
// public exception. Serves only processed PNGs, never the stored upload.
export async function googleLogoResponse(request: Request, kind: "square" | "wide", params: Promise<{ programId: string }>): Promise<Response> {
  if (!approvedGoogleAssetOrigin()) return new Response(null, { status: 404 });
  const { programId: filename } = await params;
  const programId = filename.endsWith(".png") ? filename.slice(0, -4) : "";
  if (!/^[0-9a-f-]{36}$/i.test(programId)) return new Response(null, { status: 404 });
  // One budget per address for both routes, spent only where work is done: an unknown programme, or a logo or initial
  // not remembered yet. Google's image fetcher re-reading a URL is served from memory and never limited.
  const limit = () => enforcePeerLimit(request, "wallet_google_logo_peer", 120, 15 * 60);
  try {
    const [row] = await db.select({ logoData: locations.logoData, brandColor: locations.brandColor, name: tenants.name }).from(programs)
      .innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
      .innerJoin(tenants, eq(tenants.id, programs.tenantId))
      .where(and(eq(programs.id, programId), eq(programs.status, "active"))).limit(1);
    if (!row) await limit();
    const bytes = row && await googleLogoAsset(kind, row.logoData, row.brandColor, row.name, limit);
    if (!bytes) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "image/png", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    if (error instanceof RateLimitError) return new Response(null, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    if (error instanceof InvalidIngressError) return new Response(null, { status: 503 });
    console.error("Google Wallet logo route failed", error instanceof Error ? error.name : "unknown");
    return new Response(null, { status: 500 });
  }
}
