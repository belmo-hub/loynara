"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Notice } from "./owner-ui";

const IDLE = "E-Mail erneut senden";
// U+2011 (non-breaking hyphen) keeps „E‑Mail“ and „Spam‑Ordner“ whole in the narrow action column.
export const OUTCOME = {
  sent: "Wir haben dir eine neue E‑Mail geschickt. Schau auch im Spam‑Ordner nach.",
  limited: "Zu viele Versuche. Warte bitte etwas und versuche es erneut.",
  failed: "Die E‑Mail konnte gerade nicht verschickt werden. Versuche es später erneut.",
} as const;
// Marketing, 19 Nov: the confirmation link sends the owner back here with ?error=… when it no longer works.
const linkError = (code: string) => code === "TOKEN_EXPIRED"
  ? "Dein Bestätigungslink ist abgelaufen. Mit „E-Mail erneut senden“ bekommst du einen neuen."
  : "Dieser Bestätigungslink gilt nicht mehr. Mit „E-Mail erneut senden“ bekommst du einen neuen.";

/**
 * ENG-278: mounted once by the owner shell, under the top bar, until the account's address is confirmed; until then no
 * owner mail goes out. The Übersicht says why it matters; every other screen keeps it to one sentence (Design, 19 Nov).
 */
export function VerifyEmailNotice({ email }: { email: string }) {
  const full = usePathname() === "/merchant";
  const error = useSearchParams().get("error");
  const [state, setState] = useState<"idle" | "busy" | keyof typeof OUTCOME>("idle");
  // After a mail went out the button rests for this visit: a second press within the hour would send nothing.
  const resting = state === "busy" || state === "sent";
  async function resend() {
    if (resting) return;
    setState("busy");
    try {
      const { error: failed } = await authClient.sendVerificationEmail({ email, callbackURL: "/merchant" });
      setState(!failed ? "sent" : failed.status === 429 ? "limited" : "failed");
    } catch { setState("failed"); }
  }
  // The expired line replaces "we sent you a link", which it would half contradict, until a new link went out.
  const expired = error !== null && state !== "sent";
  const at = email.indexOf("@");
  const address = at < 0 ? email : <>{email.slice(0, at + 1)}<wbr /><span className="ow-mail-domain">{email.slice(at + 1)}</span></>;
  return <div className="ow-verify">
    <Notice tone="warn" actions={<>
      {/* aria-disabled, not disabled: focus stays on the button while it rests. */}
      <button type="button" className="ow-btn ow-btn--secondary ow-btn--sm ow-verify-resend" data-idle={IDLE} onClick={resend} aria-disabled={resting || undefined}><span>{state === "busy" ? "Wird gesendet …" : IDLE}</span></button>
      <p role="status" className="ow-verify-status" data-tone={state === "limited" || state === "failed" ? "danger" : undefined}>{state in OUTCOME ? OUTCOME[state as keyof typeof OUTCOME] : null}</p>
    </>}>
      <div className="ow-verify-text">
        <strong>Bestätige deine E-Mail-Adresse.</strong>
        {expired
          ? <p>{linkError(error ?? "")}</p>
          : <p>Wir haben dir einen Link an {address} geschickt.{full && " Erst nach der Bestätigung bekommst du E‑Mails zu deinem Geschäft, zum Beispiel den Wochenbericht."}</p>}
      </div>
    </Notice>
  </div>;
}
