import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { inviteReturnPath } from "@/lib/invite-return";
import { LoginForm } from "./login-form";

// Read at request time: the register link must follow the live PUBLIC_REGISTRATION_ENABLED setting, not the build's.
export const dynamic = "force-dynamic";

type Query = { next?: string | string[]; verified?: string | string[]; error?: string | string[] };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  // ENG-341: the confirmation link lands here (account-verification.ts). A link that no longer works comes back with
  // ?error=…, which the owner's own notice explains (verify-email-notice.tsx), so only a clean landing says „bestätigt“.
  const fromLink = query.verified === "1";
  const error = typeof query.error === "string" ? query.error : null;
  if (fromLink && await auth.api.getSession({ headers: await headers() })) redirect(error ? `/merchant?error=${encodeURIComponent(error)}` : "/merchant");
  return <LoginForm registrationOpen={process.env.PUBLIC_REGISTRATION_ENABLED === "true"} next={inviteReturnPath(query.next) ?? (query.next === "/merchant/more" ? "/merchant/more" : null)} verified={fromLink && !error} />;
}
