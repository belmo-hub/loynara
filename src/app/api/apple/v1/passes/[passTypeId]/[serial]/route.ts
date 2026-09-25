import { respondError } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { applePassArchive, appleSigningConfig, appleWalletStatus } from "@/lib/wallet/apple";
import { registeredApplePass } from "@/lib/wallet/apple-service";

export async function GET(request: Request, context: { params: Promise<{ passTypeId: string; serial: string }> }) {
  if (!appleWalletStatus().ready) return new Response(null, { status: 503 });
  try {
    const params = await context.params;
    const config = appleSigningConfig();
    const pass = await registeredApplePass({ ...params, authorization: request.headers.get("authorization") ?? "" }, config);
    const bytes = await applePassArchive(pass, config);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/vnd.apple.pkpass", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    if (error instanceof DomainError && error.code === "FORBIDDEN") return new Response(null, { status: 401 });
    return respondError(error);
  }
}
