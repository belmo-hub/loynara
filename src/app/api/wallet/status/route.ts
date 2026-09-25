import { appleWalletStatus } from "@/lib/wallet/apple";
import { googleWalletStatus } from "@/lib/wallet/google";

export async function GET() {
  return Response.json({ apple: appleWalletStatus(), google: googleWalletStatus() }, { headers: { "Cache-Control": "no-store" } });
}
