"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Notice } from "./owner-ui";

const OUTCOME = {
  sent: "Wir haben dir eine neue E-Mail geschickt. Schau auch im Spam-Ordner nach.",
  limited: "Zu viele Versuche. Warte bitte etwas und versuche es erneut.",
  failed: "Die E-Mail konnte gerade nicht verschickt werden. Versuche es später erneut.",
} as const;

/** ENG-278: shown in the owner area until the account's address is confirmed; until then no owner mail goes out. */
export function VerifyEmailNotice({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "busy" | keyof typeof OUTCOME>("idle");
  async function resend() {
    setState("busy");
    try {
      const { error } = await authClient.sendVerificationEmail({ email, callbackURL: "/merchant" });
      setState(!error ? "sent" : error.status === 429 ? "limited" : "failed");
    } catch { setState("failed"); }
  }
  return <div className="ow-page ow-verify">
    <Notice tone="warn" actions={<button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={resend} disabled={state === "busy"}>E-Mail erneut senden</button>}>
      <strong>Bestätige deine E-Mail-Adresse</strong>
      <p>Wir haben dir einen Link an {email} geschickt. Erst nach der Bestätigung bekommst du E-Mails zu deinem Geschäft, zum Beispiel den Wochenbericht.</p>
      <p role="status">{state in OUTCOME ? OUTCOME[state as keyof typeof OUTCOME] : null}</p>
    </Notice>
  </div>;
}
