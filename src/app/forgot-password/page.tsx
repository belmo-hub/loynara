"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { CircleAlert } from "lucide-react";
import { AuthShell } from "@/components/ui/auth-shell";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { TextField } from "@/components/ui/field";
import { useFormCheck } from "@/components/ui/form-check";
import { authClient } from "@/lib/auth-client";
import styles from "@/components/auth/auth.module.css";
import { CONNECTION_LOST } from "@/components/auth/auth-errors";

const SUPPORT = "mailto:support@getloynara.com?subject=" + encodeURIComponent("Passwort für Loynara zurücksetzen");

// ENG-279: the same answer for every address, so the page never tells whether an account exists.
export default function ForgotPasswordPage() {
  const page = useRef<HTMLDivElement>(null);
  const ready = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const fields = useFormCheck();
  // The new state is announced: its title takes focus (Design, 19 Nov).
  useEffect(() => { const title = sent ? page.current?.querySelector("h1") : null; if (title) { title.tabIndex = -1; title.focus(); } }, [sent]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !fields.check(event.currentTarget)) return;
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setError("");
    setBusy(true);
    try {
      const { error: failed } = await authClient.requestPasswordReset({ email });
      if (failed?.status === 429) setError("Zu viele Versuche. Warte bitte etwas und versuche es erneut.");
      else if (failed) setError("Das hat gerade nicht geklappt. Versuche es später erneut.");
      else setSent(true);
    } catch { setError(CONNECTION_LOST); }
    finally { setBusy(false); }
  }

  if (sent) return <AuthShell>
    <div key="sent" ref={page} className={styles.page}>
      <PageHeader title="Schau in dein Postfach." description="Wenn es für diese Adresse ein bestätigtes Konto gibt, haben wir dir einen Link für ein neues Passwort geschickt. Er gilt eine Stunde." />
      {/* Marketing, 19 Nov: an unconfirmed owner gets no mail at all, so support is the way on. */}
      <p className={styles.note}>Nichts angekommen? Prüfe deinen Spam-Ordner oder schreibe uns an <a className={styles.link} href={SUPPORT}>support@getloynara.com</a>.</p>
      <p className={styles.note}><Link className={`${styles.link} ${styles.lone}`} href="/login">Zurück zur Anmeldung</Link></p>
    </div>
  </AuthShell>;

  return <AuthShell>
    <div key="form" className={styles.page}>
      <PageHeader title="Passwort vergessen?" description="Gib die E-Mail-Adresse deines Kontos ein. Wir schicken dir einen Link, mit dem du ein neues Passwort festlegst." />
      <div className={styles.sheet}>
        <form className={`auth-form ${styles.form}`} onSubmit={submit} onInput={fields.onInput} noValidate>
          <TextField id="fp-email" error={fields.error("fp-email")} label="E-Mail-Adresse" type="email" name="email" autoComplete="username" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="send" required maxLength={254} placeholder="du@geschaeft.de" />
          {error ? <p className={styles.alert} role="alert"><CircleAlert size={20} aria-hidden="true" />{error}</p> : null}
          <Button type="submit" block loading={busy} disabled={!ready}>{busy ? "Wird gesendet …" : "Link schicken"}</Button>
        </form>
        <p className={styles.note}><Link className={`${styles.link} ${styles.lone}`} href="/login">Zurück zur Anmeldung</Link></p>
      </div>
    </div>
  </AuthShell>;
}
