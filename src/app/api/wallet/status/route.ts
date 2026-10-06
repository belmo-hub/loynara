import { walletAvailability } from "@/lib/wallet/capability";

/**
 * Public: which Wallet buttons the card page may offer. Deliberately nothing else (no reasons, configuration names,
 * certificate dates, tool versions or paths); operators use `npm run diagnose`.
 */
export async function GET() {
  return Response.json(walletAvailability(), { headers: { "Cache-Control": "no-store" } });
}
