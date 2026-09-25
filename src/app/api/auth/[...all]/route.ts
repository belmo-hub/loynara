import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { enforcePeerLimit } from "@/lib/rate-limit";
import { respondError } from "@/lib/http";

const handlers = toNextJsHandler(auth);
export const GET = handlers.GET;

export async function POST(request: Request) {
  try {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/sign-up/email")) await enforcePeerLimit(request, "auth_signup_peer", 15, 15 * 60);
    if (path.endsWith("/sign-in/email")) await enforcePeerLimit(request, "auth_signin_peer", 30, 15 * 60);
    return handlers.POST(request);
  } catch (error) { return respondError(error); }
}
