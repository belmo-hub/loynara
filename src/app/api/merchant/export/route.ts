import { getMerchantCsv, getMerchantExport } from "@/lib/export";
import { DomainError } from "@/lib/loyalty";
import { respondError, sessionUser } from "@/lib/http";

const privateDownload = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

/** Owner export: the full JSON by default, or `?format=karten` / `?format=buchungen` as Excel-ready CSV (ENG-004). */
export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    const format = new URL(request.url).searchParams.get("format");
    if (format === "karten" || format === "buchungen") {
      const { filename, body } = await getMerchantCsv(user.id, format);
      return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, ...privateDownload } });
    }
    if (format !== null) throw new DomainError("INVALID_FORMAT", "Unknown export format");
    return new Response(JSON.stringify(await getMerchantExport(user.id)), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="loynara-merchant-export.json"', ...privateDownload } });
  } catch (error) { return respondError(error); }
}
