import { respondError } from "@/lib/http";
import { appleSigningConfig, appleWalletStatus } from "@/lib/wallet/apple";
import { listUpdatedApplePasses } from "@/lib/wallet/apple-service";

export async function GET(request: Request, context: { params: Promise<{ deviceId: string; passTypeId: string }> }) {
  if (!appleWalletStatus().ready) return new Response(null, { status: 503 });
  try {
    const { deviceId, passTypeId } = await context.params;
    if (passTypeId !== appleSigningConfig().passTypeId) return new Response(null, { status: 404 });
    const result = await listUpdatedApplePasses(deviceId, passTypeId, new URL(request.url).searchParams.get("passesUpdatedSince") ?? undefined);
    return result ? Response.json(result, { headers: { "Cache-Control": "no-store" } }) : new Response(null, { status: 204 });
  } catch (error) { return respondError(error); }
}
