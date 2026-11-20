import type { APIRequestContext } from "@playwright/test";

type SignUp = { headers?: Record<string, string>; data: { email: string; password: string; [field: string]: unknown } };

/**
 * Sign-up never signs in (ENG-283), so this signs the new account in with the same request context. It answers with the
 * sign-in response (200, with the user), or with the refused sign-up.
 */
export async function signUp(request: APIRequestContext, options: SignUp) {
  const response = await request.post("/api/auth/sign-up/email", options);
  if (!response.ok()) return response;
  const { email, password } = options.data;
  const signIn = await request.post("/api/auth/sign-in/email", { headers: options.headers, data: { email, password } });
  if (!signIn.ok()) throw new Error(`Sign-in after sign-up answered ${signIn.status()}`);
  return signIn;
}
