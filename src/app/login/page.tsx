import { LoginForm } from "./login-form";

// Read at request time: the register link must follow the live PUBLIC_REGISTRATION_ENABLED setting, not the build's.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginForm registrationOpen={process.env.PUBLIC_REGISTRATION_ENABLED === "true"} />;
}
