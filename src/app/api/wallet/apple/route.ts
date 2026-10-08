import { requireSameOrigin } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { walletJsonBody } from "@/lib/wallet/body";
import { WALLET_HTTP_MS, withWalletDatabase } from "@/lib/wallet/database";
import { walletCardEligibility } from "@/lib/wallet/eligibility";
import { cardTokenFrom, noStore, walletIssueError, walletUnavailable } from "@/lib/wallet/http";
import { issueWalletPass } from "@/lib/wallet/issue";
import { passFastObjectId } from "@/lib/wallet/passfast";
import { applePreparation, walletDeploymentAvailability } from "@/lib/wallet/preparation";

/** Commit a stable local projection/outbox job promptly. Provider synchronization belongs exclusively to the worker. */
export async function POST(request: Request) {
  if (walletDeploymentAvailability().apple !== "available") return walletUnavailable();
  const deadline = Date.now() + WALLET_HTTP_MS;
  try {
    requireSameOrigin(request);
    const token = cardTokenFrom(await walletJsonBody(request,deadline));
    return await withWalletDatabase(async (database,client) => {
      await enforcePeerLimit(request,"wallet_apple_peer",30,15*60,client);
      await enforceRateLimit({scope:"wallet_apple_token",identity:token,max:10,windowSeconds:15*60},client);
      const eligibility = await walletCardEligibility(token,database);
      if (eligibility.availability.apple !== "available") return walletUnavailable();
      await issueWalletPass(token,"apple",process.env.PASSFAST_ENABLED === "true" ? passFastObjectId : id => id,database);
      const prepared = await applePreparation(eligibility,database);
      if (prepared.status === "ready") return Response.json({status:"ready",url:prepared.url},{headers:noStore});
      if (prepared.status !== "pending") return walletUnavailable();
      return Response.json({status:"pending"},{status:202,headers:{...noStore,"Retry-After":"5"}});
    },deadline-Date.now());
  } catch (error) { return walletIssueError(error); }
}
