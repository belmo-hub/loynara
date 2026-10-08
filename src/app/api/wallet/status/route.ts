import { requireSameOrigin } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { walletJsonBody } from "@/lib/wallet/body";
import { WALLET_HTTP_MS, withWalletDatabase } from "@/lib/wallet/database";
import { walletCardEligibility } from "@/lib/wallet/eligibility";
import { cardTokenFrom, noStore, walletIssueError } from "@/lib/wallet/http";
import { applePreparation } from "@/lib/wallet/preparation";

/** Unauthenticated deployment-wide capability grants no customer action. */
export async function GET() {
  return Response.json({apple:"unavailable",google:"unavailable"},{headers:noStore});
}
/** Current card bearer in same-origin body only; no tenant/location/pass identity supplied by the browser is used. */
export async function POST(request: Request) {
  const deadline = Date.now() + WALLET_HTTP_MS;
  try {
    requireSameOrigin(request);
    const token = cardTokenFrom(await walletJsonBody(request,deadline));
    return await withWalletDatabase(async(database,client) => {
      await enforcePeerLimit(request,"wallet_status_peer",600,15*60,client);
      await enforceRateLimit({scope:"wallet_status_token",identity:token,max:90,windowSeconds:15*60},client);
      const eligibility = await walletCardEligibility(token,database);
      return Response.json({...eligibility.availability,applePass:await applePreparation(eligibility,database)},{headers:noStore});
    },deadline-Date.now());
  } catch(error) { return walletIssueError(error); }
}
