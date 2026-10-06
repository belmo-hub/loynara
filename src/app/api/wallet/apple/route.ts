import { jsonBody, requireSameOrigin } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { walletAvailability } from "@/lib/wallet/capability";
import { cardTokenFrom, noStore, walletIssueError, walletUnavailable } from "@/lib/wallet/http";
import { issueWalletPass } from "@/lib/wallet/issue";
import { createDownloadTicket } from "@/lib/wallet/ticket";

/**
 * Step 1 of "Add to Apple Wallet": the card page POSTs its bearer token (body, never URL) and receives a two-minute
 * download URL for this card's current pass. The pass archive itself is signed in step 2 (download/[ticket]).
 */
export async function POST(request: Request) {
  if (walletAvailability().apple !== "available") return walletUnavailable();
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "wallet_apple_peer", 30, 15 * 60);
    const token = cardTokenFrom(await jsonBody(request, 1000));
    await enforceRateLimit({ scope: "wallet_apple_token", identity: token, max: 10, windowSeconds: 15 * 60 });
    const pass = await issueWalletPass(token, "apple", id => id);
    return Response.json({ url: `/api/wallet/apple/download/${createDownloadTicket(pass.id)}` }, { headers: noStore });
  } catch (error) { return walletIssueError(error); }
}
