import type { APIRequestContext } from "@playwright/test";
import { SIGNUP_ACCEPTANCE_HEADER, SIGNUP_ACCEPTANCE_TEXT_VERSION } from "../../src/lib/owner-contract";

type SignUp = { headers?: Record<string, string>; data: { email: string; password: string; [field: string]: unknown } };

/**
 * Sign-up never signs in (ENG-283), so this signs the new account in with the same request context. It answers with the
 * sign-in response (200, with the user), or with the refused sign-up.
 */
export async function signUp(request: APIRequestContext, options: SignUp) {
  // ENG-277: as /register sends it, so the account may set up a shop.
  const response = await request.post("/api/auth/sign-up/email", { ...options, headers: { [SIGNUP_ACCEPTANCE_HEADER]: SIGNUP_ACCEPTANCE_TEXT_VERSION, ...options.headers } });
  if (!response.ok()) return response;
  const { email, password } = options.data;
  const signIn = await request.post("/api/auth/sign-in/email", { headers: options.headers, data: { email, password } });
  if (!signIn.ok()) throw new Error(`Sign-in after sign-up answered ${signIn.status()}`);
  return signIn;
}
