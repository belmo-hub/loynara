import { respondError } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { appleSigningConfig, appleWalletStatus } from "@/lib/wallet/apple";
import { registerAppleDevice, unregisterAppleDevice } from "@/lib/wallet/apple-service";

type Params = { params: Promise<{ deviceId: string; passTypeId: string; serial: string }> };

function errorResponse(error: unknown) {
  if (error instanceof DomainError && error.code === "FORBIDDEN") return new Response(null, { status: 401 });
  return respondError(error);
}

export async function POST(request: Request, context: Params) {
  if (!appleWalletStatus().ready) return new Response(null, { status: 503 });
  try {
    const params = await context.params;
    if (!request.headers.get("content-type")?.startsWith("application/json")) return new Response(null, { status: 400 });
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 1000) return new Response(null, { status: 413 });
    const body = JSON.parse(raw);
    if (typeof body.pushToken !== "string") return new Response(null, { status: 400 });
    const result = await registerAppleDevice({ ...params, authorization: request.headers.get("authorization") ?? "", pushToken: body.pushToken }, appleSigningConfig());
    return new Response(null, { status: result });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, context: Params) {
  if (!appleWalletStatus().ready) return new Response(null, { status: 503 });
  try {
    await unregisterAppleDevice({ ...(await context.params), authorization: request.headers.get("authorization") ?? "" }, appleSigningConfig());
    return new Response(null, { status: 200 });
  } catch (error) { return errorResponse(error); }
}
