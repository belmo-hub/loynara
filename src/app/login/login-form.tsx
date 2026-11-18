"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { CircleAlert } from "lucide-react";
import { AuthShell } from "@/components/ui/auth-shell";
import { LegalLinks } from "@/components/ui/legal-links";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { TextField } from "@/components/ui/field";
import { useFormCheck } from "@/components/ui/form-check";
import { authClient } from "@/lib/auth-client";
import { withInviteReturn } from "@/lib/invite-return";
import styles from "@/components/auth/auth.module.css";

// Owners have no self-service reset yet: the link opens a prepared mail to support, nothing is sent from the page.
const RESET_MAIL = "mailto:support@getloynara.com?subject=" + encodeURIComponent("Passwort für Loynara zurücksetzen");

export function LoginForm({ registrationOpen, next = null }: { registrationOpen: boolean; next?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fields = useFormCheck({ "login-password": "Bitte gib dein Passwort ein." });
  // Until the page is interactive, a tap on "Anmelden" would submit the bare form natively and just reload the page, wiping the fields.
  const ready = useSyncExternalStore(() => () => undefined, () => true, () => false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The button only shows "loading" (it keeps focus), so Enter in a field would submit again: ignore it while a request runs.
    if (busy) return;
    const formElement = event.currentTarget;
    if (!fields.check(formElement)) return;
    // The fields are uncontrolled: text typed or autofilled before hydration finished is kept, where a controlled field
    // would be reset to its empty initial state and the browser's "required" check would then swallow the submit silently.
    const form = new FormData(formElement);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setBusy(true); setError("");
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        // HTTP rejection and lost transport have different certainty. Never display library diagnostics.
        if (result.error.code === "INVALID_EMAIL_OR_PASSWORD") {
          setError("E-Mail-Adresse oder Passwort stimmen nicht. Prüfe deine Angaben.");
          // The address is usually right: put the caret back into the password, ready to retype.
          const field = formElement.elements.namedItem("password");
          if (field instanceof HTMLInputElement) { field.focus(); field.select(); }
        }
        else if (result.error.status === 429) setError("Zu viele Anmeldeversuche. Warte bitte etwas und versuche es erneut.");
        else if (result.error.status >= 500 || result.error.code === "FAILED_TO_CREATE_SESSION") setError("Die Anmeldung ist vorübergehend nicht möglich. Deine Angaben bleiben erhalten. Versuche es später erneut.");
        else setError("Die Anmeldung wurde nicht bestätigt. Prüfe deine Angaben oder wende dich an Loynara.");
        return;
      }
      if (!result.data?.user) {
        setError("Die Anmeldung konnte nicht bestätigt werden. Prüfe deine Verbindung und versuche es erneut.");
        return;
      }
      router.push(next ?? "/merchant");
      router.refresh();
    } catch {
      setError("Die Anmeldung konnte nicht bestätigt werden. Prüfe deine Verbindung und versuche es erneut.");
    } finally { setBusy(false); }
  }

  // Design's screen 34 (ENG-122h): the mark alone, the larger question, the legal links right under the form, muted like
  // everywhere else (G-22: green is the one next step). Copy is live (R22).
  return <AuthShell mark footer={null}>
    <div className={styles.page}>
      <PageHeader className={styles.signin} title="Gut, dass du da bist." description="Melde dich an, um dein Treueprogramm und die Kasse zu öffnen." />
      <div className={styles.sheet}>
        <form className={`auth-form ${styles.form}`} onSubmit={submit} onInput={fields.onInput} noValidate>
          <TextField id="login-email" error={fields.error("login-email")} label="E-Mail-Adresse" type="email" name="email" autoComplete="username" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" required placeholder="du@geschaeft.de" />
          <TextField id="login-password" error={fields.error("login-password")} label="Passwort" type="password" name="password" autoComplete="current-password" enterKeyHint="go" required />
          <a className={styles.forgot} href={RESET_MAIL}>Passwort vergessen?</a>
          {error ? <p className={styles.alert} role="alert"><CircleAlert size={20} aria-hidden="true" />{error}</p> : null}
          <Button type="submit" block loading={busy} disabled={!ready}>{busy ? "Anmeldung läuft …" : "Anmelden"}</Button>
        </form>
        <p className={styles.note}>{registrationOpen
          ? <>Noch kein Konto? <Link className={styles.link} href={withInviteReturn("/register", next)}>Konto erstellen</Link></>
          : <>Noch keinen Zugang? Loynara richtet ihn gemeinsam mit dir ein.</>}</p>
      </div>
      <LegalLinks />
    </div>
  </AuthShell>;
}
