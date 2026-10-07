import { appleSigningConfig, appleWalletStatus } from "@/lib/wallet/apple";
import { listUpdatedApplePasses } from "@/lib/wallet/apple-service";
import { appleServiceError, appleServiceLimits } from "@/lib/wallet/http";

export async function GET(request: Request, context: { params: Promise<{ deviceId: string; passTypeId: string }> }) {
  if (!appleWalletStatus().ready) return new Response(null, { status: 503 });
  const { deviceId, passTypeId } = await context.params;
  const limited = await appleServiceLimits(request, [{ scope: "wallet_apple_ws_list", identity: deviceId.slice(0, 200), max: 120 }]);
  if (limited) return limited;
  try {
    if (passTypeId !== appleSigningConfig().passTypeId) return new Response(null, { status: 404 });
    const result = await listUpdatedApplePasses(deviceId, passTypeId, new URL(request.url).searchParams.get("passesUpdatedSince") ?? undefined);
    return result ? Response.json(result, { headers: { "Cache-Control": "no-store" } }) : new Response(null, { status: 204 });
  } catch (error) { return appleServiceError(error); }
}
