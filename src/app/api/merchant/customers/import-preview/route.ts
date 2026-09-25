import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { staffRoles } from "@/db/schema";
import { ImportPreviewError, isLocalImportPreviewOrigin, previewSyntheticCsv } from "@/lib/customer-import-preview";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const input = z.object({
  csv: z.string().min(1).max(64_000),
  mapping: z.object({
    externalId: z.string().trim().min(1).max(80),
    email: z.string().trim().max(80).optional(),
    balance: z.string().trim().max(80).optional(),
    marketingConsent: z.string().trim().max(80).optional(),
    consentSource: z.string().trim().max(80).optional(),
    consentDate: z.string().trim().max(80).optional(),
  }).strict(),
}).strict();

async function requireLocalOwner(request: Request) {
  if (!isLocalImportPreviewOrigin(process.env.PUBLIC_BASE_URL) ||
    !isLocalImportPreviewOrigin(new URL(request.url).origin) ||
    !isLocalImportPreviewOrigin(`http://${request.headers.get("host") ?? ""}`)) {
    throw new DomainError("NOT_FOUND", "Import preview unavailable");
  }
  const user = await sessionUser(request);
  const [owner] = await db.select({ userId: staffRoles.userId }).from(staffRoles)
    .where(and(eq(staffRoles.userId, user.id), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))).limit(1);
  if (!owner) throw new DomainError("FORBIDDEN", "Owner access required");
  return user;
}

export async function GET(request: Request) {
  try {
    await enforcePeerLimit(request, "customer_import_preview_get_peer", 120, 15 * 60);
    await requireLocalOwner(request);
    return Response.json({ available: true, syntheticOnly: true, writesPerformed: false }, { headers });
  } catch (error) { return respondError(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "customer_import_preview_post_peer", 60, 15 * 60);
    const owner = await requireLocalOwner(request);
    await enforceRateLimit({ scope: "customer_import_preview_post_user", identity: owner.id, max: 30, windowSeconds: 15 * 60 });
    const parsed = input.parse(await jsonBody(request, 90_000));
    try { return Response.json(previewSyntheticCsv(parsed.csv, parsed.mapping), { headers }); }
    catch (error) {
      if (error instanceof ImportPreviewError) throw new DomainError("INVALID_CSV", error.message);
      throw error;
    }
  } catch (error) { return respondError(error); }
}
