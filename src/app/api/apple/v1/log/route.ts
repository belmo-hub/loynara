import { enforcePeerLimit } from "@/lib/rate-limit";
import { appleServiceError } from "@/lib/wallet/http";

// Wallet's optional client log endpoint. We deliberately do not read, persist or log device diagnostics or tokens.
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return new Response(null, { status: 413 });
  try { await enforcePeerLimit(request, "wallet_apple_log_peer", 30, 15 * 60); } catch (error) { return appleServiceError(error); }
  return new Response(null, { status: 200 });
}
