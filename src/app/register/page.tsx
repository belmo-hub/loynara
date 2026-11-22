"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { CircleAlert } from "lucide-react";
import { AuthShell } from "@/components/ui/auth-shell";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { TextField } from "@/components/ui/field";
import { useFormCheck } from "@/components/ui/form-check";
import { authClient } from "@/lib/auth-client";
import { inviteReturnPath, withInviteReturn } from "@/lib/invite-return";
import { OWNER_AVV, OWNER_TERMS, SIGNUP_ACCEPTANCE_HEADER, SIGNUP_ACCEPTANCE_TEXT_VERSION } from "@/lib/owner-contract";
import { OWNER_PRIVACY_NOTICE } from "@/lib/owner-privacy";
import styles from "@/components/auth/auth.module.css";
import { CONNECTION_LOST, PASSWORD_MAX, PASSWORD_MIN, signUpMessage } from "@/components/auth/auth-errors";
import { OUTCOME } from "@/components/owner/verify-email-notice";

// Marketing, 19 Nov (the password page's line): when no mail arrives, the spam folder and then support are the way on.
const SUPPORT = "mailto:support@getloynara.com";

export default function RegisterPage() {
  const page = useRef<HTMLDivElement>(null);
  // A staff member coming from an invitation goes back to it, not into the owner's shop setup.
  const next = inviteReturnPath(useSearchParams().get("next"));
  // Until the page is interactive, a tap would submit the bare form natively and reload it, wiping the fields.
  const ready = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [mismatch, setMismatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [resend, setResend] = useState<"idle" | "busy" | "sent" | "limited" | "failed">("idle");
  const fields = useFormCheck();
  // The new state is announced: its title takes focus, as on „Passwort vergessen“.
  useEffect(() => { const title = sent ? page.current?.querySelector("h1") : null; if (title) { title.tabIndex = -1; title.focus(); } }, [sent]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !fields.check(event.currentTarget)) return;
    // Uncontrolled fields: values typed or autofilled before hydration finished are read here, not lost.
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim(), email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? ""), confirmation = String(form.get("confirmation") ?? "");
    setError("");
    if (password !== confirmation) { setMismatch(true); return; }
    setBusy(true);
    try {
      let result: Awaited<ReturnType<typeof authClient.signUp.email>>;
      try { result = await authClient.signUp.email({ name, email, password, ...(next ? {} : { fetchOptions: { headers: { [SIGNUP_ACCEPTANCE_HEADER]: SIGNUP_ACCEPTANCE_TEXT_VERSION } } }) }); }
      catch { setError(CONNECTION_LOST); return; }
      if (result.error) { setError(signUpMessage(result.error, "register")); return; }
      setSent(email);
    } finally { setBusy(false); }
  }

  // ENG-342: the same anonymous, per-address and per-peer limited resend as the owner's notice. Signed out, it answers
  // every address alike (auth.ts), so „sent“ here says nothing about whether an account exists.
  async function again() {
    if (!sent || resend === "busy" || resend === "sent") return;
    setResend("busy");
    try {
      const { error: failed } = await authClient.sendVerificationEmail({ email: sent, callbackURL: "/merchant" });
      setResend(!failed ? "sent" : failed.status === 429 ? "limited" : "failed");
    } catch { setResend("failed"); }
  }

  // ENG-283: a new and an existing address get this same answer, so the page never tells whether an account exists.
  if (sent) return <AuthShell>
    <div key="sent" ref={page} className={styles.page}>
      <PageHeader title="Schau in dein Postfach." description={<>Wir haben dir einen Link an <strong className={styles.address}>{sent}</strong> geschickt. Bestätige damit deine E-Mail-Adresse und melde dich dann an. Hast du schon ein Konto mit dieser Adresse, melde dich einfach an.</>} />
      <div className={styles.resend}>
        {/* aria-disabled, not disabled: focus stays on the button while it rests after a mail went out. */}
        <Button variant="secondary" className={resend === "sent" ? styles.resting : undefined} onClick={again} loading={resend === "busy"} aria-disabled={resend === "busy" || resend === "sent" || undefined}>E-Mail erneut senden</Button>
        {/* Always mounted, so a screen reader hears the outcome; the inner line fades in per outcome. */}
        <p role="status" className={styles.resendStatus} data-tone={resend === "limited" || resend === "failed" ? "danger" : undefined}>{resend === "sent" || resend === "limited" || resend === "failed" ? <span key={resend}>{OUTCOME[resend]}</span> : null}</p>
        <p className={styles.note}>Nichts angekommen? Prüfe deinen Spam‑Ordner oder schreibe uns an <a className={styles.link} href={SUPPORT}>support@getloynara.com</a>.</p>
      </div>
      <p className={styles.note}><Link className={`${styles.link} ${styles.lone}`} href={withInviteReturn("/login", next)}>Zur Anmeldung</Link></p>
    </div>
  </AuthShell>;

  return <AuthShell>
    <div key="form" className={styles.page}>
      <PageHeader title="Leg los mit Loynara." description="Erstelle dein Konto. Danach richtest du dein erstes Treueprogramm ein." />
      <div className={styles.sheet}>
        <form className={`auth-form ${styles.form}`} onSubmit={submit} onInput={fields.onInput} noValidate>
          <TextField id="rg-name" error={fields.error("rg-name")} label="Dein Name" name="name" autoComplete="name" autoCapitalize="words" enterKeyHint="next" required maxLength={120} placeholder="Vor- und Nachname" />
          <TextField id="rg-email" error={fields.error("rg-email")} label="E-Mail-Adresse" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" name="email" required maxLength={254} placeholder="du@geschaeft.de" />
          <TextField id="rg-password" error={fields.error("rg-password")} label="Passwort" type="password" name="password" autoComplete="new-password" enterKeyHint="next" onChange={() => setMismatch(false)} required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} hint={`Mindestens ${PASSWORD_MIN}, höchstens ${PASSWORD_MAX} Zeichen.`} />
          <TextField id="rg-confirmation" label="Passwort wiederholen" type="password" name="confirmation" autoComplete="new-password" enterKeyHint="go" onChange={() => setMismatch(false)} required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX}
            error={fields.error("rg-confirmation") ?? (mismatch ? "Die Passwörter stimmen nicht überein." : undefined)} />
          {error ? <p className={styles.alert} role="alert"><CircleAlert size={20} aria-hidden="true" />{error}</p> : null}
          {/* ENG-277, Legal's sentence: the click makes the shop's contract. Staff from an invitation conclude nothing here. */}
          {next ? null : <p className={styles.note}>Mit „Konto erstellen“ schließt du für dein Geschäft den Vertrag mit Loynara nach den <Link className={styles.link} href={OWNER_TERMS.href} target="_blank" rel="noopener">Vertragsbedingungen für Geschäfte</Link> und dem <Link className={styles.link} href={OWNER_AVV.href} target="_blank" rel="noopener">Vertrag zur Auftragsverarbeitung</Link>. Der erste Monat ist gratis; kündigst du in diesem Monat, kostet es nichts. Danach kostet Loynara 49 € pro Monat und Standort, bis du kündigst. Wie wir deine Daten verarbeiten, steht in den <Link className={styles.link} href={OWNER_PRIVACY_NOTICE.href} target="_blank" rel="noopener">Datenschutzhinweisen für Geschäfte</Link>.</p>}
          <Button type="submit" block loading={busy} disabled={!ready}>{busy ? "Konto wird erstellt …" : "Konto erstellen"}</Button>
          {next ? <p className={styles.note}>Es wird keine Zahlung ausgelöst.</p> : null}
        </form>
        <p className={styles.note}>Du hast schon ein Konto? <Link className={styles.link} href={withInviteReturn("/login", next)}>Anmelden</Link></p>
      </div>
    </div>
  </AuthShell>;
}
