import { PasswordQuestion } from "@/components/owner/password-question";

// Konto's „Passwort ändern“ (ENG-379): every signed-in owner and manager; the Kasse never reaches Mehr.
export default function PasswordRoute() {
  return <PasswordQuestion />;
}
