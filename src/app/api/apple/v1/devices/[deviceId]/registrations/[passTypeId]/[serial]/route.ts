import { appleSigningConfig, appleWalletStatus } from "@/lib/wallet/apple";
import { registerAppleDevice, unregisterAppleDevice } from "@/lib/wallet/apple-service";
import { appleServiceError, appleServiceLimits } from "@/lib/wallet/http";

type Params = { params: Promise<{ deviceId: string; passTypeId: string; serial: string }> };

export async function POST(request: Request, context: Params) {
  if (!appleWalletStatus().ready) return new Response(null, { status: 503 });
  const params = await context.params;
  const limited = await appleServiceLimits(request, [{ scope: "wallet_apple_ws_device", identity: params.deviceId.slice(0, 200), max: 60 }]);
  if (limited) return limited;
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json")) return new Response(null, { status: 400 });
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 1000) return new Response(null, { status: 413 });
    let body: { pushToken?: unknown };
    try { body = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
    if (typeof body?.pushToken !== "string") return new Response(null, { status: 400 });
    const result = await registerAppleDevice({ ...params, authorization: request.headers.get("authorization") ?? "", pushToken: body.pushToken }, appleSigningConfig());
    return new Response(null, { status: result });
  } catch (error) { return appleServiceError(error); }
}

export async function DELETE(request: Request, context: Params) {
  if (!appleWalletStatus().ready) return new Response(null, { status: 503 });
  const params = await context.params;
  const limited = await appleServiceLimits(request, [{ scope: "wallet_apple_ws_device", identity: params.deviceId.slice(0, 200), max: 60 }]);
  if (limited) return limited;
  try {
    await unregisterAppleDevice({ ...params, authorization: request.headers.get("authorization") ?? "" }, appleSigningConfig());
    return new Response(null, { status: 200 });
  } catch (error) { return appleServiceError(error); }
}
