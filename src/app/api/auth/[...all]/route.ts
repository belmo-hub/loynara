import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { enforcePeerLimit, peerIdentity } from "@/lib/rate-limit";
import { respondError } from "@/lib/http";

const handlers = toNextJsHandler(auth);
function validateIngress(request: Request) {
  // All auth endpoints can reach Better Auth's own IP limits/session metadata.
  // Validate first, including endpoints without an additional outer peer limit.
  peerIdentity(request);
}
export async function GET(request: Request) {
  try { validateIngress(request); return await handlers.GET(request); }
  catch (error) { return respondError(error); }
}

export async function POST(request: Request) {
  try {
    validateIngress(request);
    const path = new URL(request.url).pathname;
    if (path.endsWith("/sign-up/email")) await enforcePeerLimit(request, "auth_signup_peer", 15, 15 * 60);
    if (path.endsWith("/sign-in/email")) await enforcePeerLimit(request, "auth_signin_peer", 30, 15 * 60);
    return handlers.POST(request);
  } catch (error) { return respondError(error); }
}
