import { applePassArchive, applePassJson, appleSigningConfig, appleVoidedPassJson, appleWalletStatus } from "@/lib/wallet/apple";
import { authenticatedApplePass } from "@/lib/wallet/apple-service";
import { appleServiceError, appleServiceLimits } from "@/lib/wallet/http";

/** The latest version of one pass: the live card while it is valid, a voided pass after reissue or closure. */
export async function GET(request: Request, context: { params: Promise<{ passTypeId: string; serial: string }> }) {
  if (!appleWalletStatus().ready) return new Response(null, { status: 503 });
  const params = await context.params;
  const limited = await appleServiceLimits(request, [{ scope: "wallet_apple_ws_pass", identity: params.serial.slice(0, 64), max: 60 }]);
  if (limited) return limited;
  try {
    const config = appleSigningConfig();
    const view = await authenticatedApplePass({ ...params, authorization: request.headers.get("authorization") ?? "" }, config);
    const json = view.kind === "active" ? applePassJson(view.pass, view.passId, config) : appleVoidedPassJson(view.pass, view.passId, config);
    const bytes = await applePassArchive(json, view.pass, config);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/vnd.apple.pkpass", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Last-Modified": view.updatedAt.toUTCString() } });
  } catch (error) { return appleServiceError(error); }
}
