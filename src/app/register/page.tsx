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
import styles from "@/components/auth/auth.module.css";
import { CONNECTION_LOST, PASSWORD_MAX, PASSWORD_MIN, signUpMessage } from "@/components/auth/auth-errors";

export default function RegisterPage() {
  const page = useRef<HTMLDivElement>(null);
  // A staff member coming from an invitation goes back to it, not into the owner's shop setup.
  const next = inviteReturnPath(useSearchParams().get("next"));
  // Until the page is interactive, a tap would submit the bare form natively and reload it, wiping the fields.
  const ready = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [mismatch, setMismatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
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
      try { result = await authClient.signUp.email({ name, email, password }); }
      catch { setError(CONNECTION_LOST); return; }
      if (result.error) { setError(signUpMessage(result.error, "register")); return; }
      setSent(true);
    } finally { setBusy(false); }
  }

  // ENG-283: a new and an existing address get this same answer, so the page never tells whether an account exists.
  if (sent) return <AuthShell>
    <div key="sent" ref={page} className={styles.page}>
      <PageHeader title="Schau in dein Postfach." description="Wir haben dir einen Link geschickt. Bestätige damit deine E-Mail-Adresse und melde dich dann an. Hast du schon ein Konto mit dieser Adresse, melde dich einfach an." />
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
          <Button type="submit" block loading={busy} disabled={!ready}>{busy ? "Konto wird erstellt …" : "Konto erstellen"}</Button>
          <p className={styles.note}>Es wird keine Zahlung ausgelöst.</p>
        </form>
        <p className={styles.note}>Du hast schon ein Konto? <Link className={styles.link} href={withInviteReturn("/login", next)}>Anmelden</Link></p>
      </div>
    </div>
  </AuthShell>;
}
