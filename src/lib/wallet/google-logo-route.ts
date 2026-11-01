import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { locations, programs, tenants } from "@/db/schema";
import { enforcePeerLimit } from "@/lib/rate-limit";
import { appleServiceError } from "./http";
import { approvedGoogleAssetOrigin, googleLogoAsset } from "./logo";

// Disabled until the operator approves a narrow provider-facing HTTPS asset route. Browser pages and card tokens need no
// public exception. Serves only processed PNGs, never the stored upload.
export async function googleLogoResponse(request: Request, kind: "square" | "wide", params: Promise<{ programId: string }>): Promise<Response> {
  if (!approvedGoogleAssetOrigin()) return new Response(null, { status: 404 });
  // One budget per address for both routes. Google's image fetcher reads each versioned URL a few times; 120 in 15
  // minutes leaves it ample room and stops anyone from turning the public routes into a processing load.
  try { await enforcePeerLimit(request, "wallet_google_logo_peer", 120, 15 * 60); } catch (error) { return appleServiceError(error); }
  const { programId: filename } = await params;
  const programId = filename.endsWith(".png") ? filename.slice(0, -4) : "";
  if (!/^[0-9a-f-]{36}$/i.test(programId)) return new Response(null, { status: 404 });
  const [row] = await db.select({ logoData: locations.logoData, brandColor: locations.brandColor, name: tenants.name }).from(programs)
    .innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
    .innerJoin(tenants, eq(tenants.id, programs.tenantId))
    .where(and(eq(programs.id, programId), eq(programs.status, "active"))).limit(1);
  const bytes = row && await googleLogoAsset(kind, row.logoData, row.brandColor, row.name);
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(bytes), { headers: {
    "Content-Type": "image/png", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff",
  } });
}
