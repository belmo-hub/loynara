import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { locations, programs } from "@/db/schema";
import { approvedGoogleAssetOrigin, decodeMerchantLogoPng } from "@/lib/wallet/logo";

// This route is disabled until the operator approves a narrow provider-facing
// HTTPS asset route. Browser pages and card tokens need no public exception.
export async function GET(_request: Request, { params }: { params: Promise<{ programId: string }> }) {
  if (!approvedGoogleAssetOrigin()) return new Response(null, { status: 404 });
  const { programId: filename } = await params;
  const programId = filename.endsWith(".png") ? filename.slice(0, -4) : "";
  if (!/^[0-9a-f-]{36}$/i.test(programId)) return new Response(null, { status: 404 });
  const [row] = await db.select({ logoData: locations.logoData }).from(programs)
    .innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
    .where(and(eq(programs.id, programId), eq(programs.status, "active"))).limit(1);
  const bytes = decodeMerchantLogoPng(row?.logoData);
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(bytes), { headers: {
    "Content-Type": "image/png", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff",
  } });
}
