"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { CircleAlert } from "lucide-react";
import { AuthShell } from "@/components/ui/auth-shell";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { TextField } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";
import styles from "@/components/auth/auth.module.css";
import { CONNECTION_LOST, PASSWORD_MAX, PASSWORD_MIN, signUpMessage } from "@/components/auth/auth-errors";

export default function RegisterPage() {
  const router = useRouter();
  // Until the page is interactive, a tap would submit the bare form natively and reload it, wiping the fields.
  const ready = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [mismatch, setMismatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
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
      router.push("/merchant/program");
      router.refresh();
    } finally { setBusy(false); }
  }

  return <AuthShell>
    <div className={styles.page}>
      <PageHeader title="Leg los mit Loynara." description="Erstelle dein Konto. Danach richtest du dein erstes Treueprogramm ein." />
      <div className={styles.sheet}>
        <form className={`auth-form ${styles.form}`} onSubmit={submit}>
          <TextField label="Dein Name" name="name" autoComplete="name" autoCapitalize="words" enterKeyHint="next" required maxLength={120} placeholder="Vor- und Nachname" />
          <TextField label="E-Mail-Adresse" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" name="email" required maxLength={254} placeholder="du@geschaeft.de" />
          <TextField label="Passwort" type="password" name="password" autoComplete="new-password" enterKeyHint="next" onChange={() => setMismatch(false)} required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} hint={`Mindestens ${PASSWORD_MIN}, höchstens ${PASSWORD_MAX} Zeichen.`} />
          <TextField label="Passwort wiederholen" type="password" name="confirmation" autoComplete="new-password" enterKeyHint="go" onChange={() => setMismatch(false)} required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX}
            error={mismatch ? "Die Passwörter stimmen nicht überein." : undefined} />
          {error ? <p className={styles.alert} role="alert"><CircleAlert size={18} aria-hidden="true" />{error}</p> : null}
          <Button type="submit" size="lg" block loading={busy} disabled={!ready}>{busy ? "Konto wird erstellt …" : "Konto erstellen"}</Button>
          <p className={styles.note}>Es wird keine Zahlung ausgelöst. Die öffentliche Registrierung bleibt bis zur Freigabe durch Loynara gesperrt.</p>
        </form>
        <p className={styles.note}>Du hast schon ein Konto? <Link className={styles.link} href="/login">Anmelden</Link></p>
      </div>
    </div>
  </AuthShell>;
}
