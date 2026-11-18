import { inviteReturnPath } from "@/lib/invite-return";
import { LoginForm } from "./login-form";

// Read at request time: the register link must follow the live PUBLIC_REGISTRATION_ENABLED setting, not the build's.
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  return <LoginForm registrationOpen={process.env.PUBLIC_REGISTRATION_ENABLED === "true"} next={inviteReturnPath((await searchParams).next)} />;
}
