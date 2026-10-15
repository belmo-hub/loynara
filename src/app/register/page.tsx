"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CircleAlert } from "lucide-react";
import { AuthShell } from "@/components/ui/auth-shell";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { TextField } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";
import styles from "@/components/auth/auth.module.css";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (password !== confirmation) { setMismatch(true); return; }
    setBusy(true);
    try {
      const result = await authClient.signUp.email({ name: name.trim(), email: email.trim(), password });
      if (result.error) throw new Error(result.error.message || "Registrierung fehlgeschlagen.");
      router.push("/merchant/program");
      router.refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Registrierung fehlgeschlagen.";
      setError(/registration is not enabled/i.test(message) ? "Die öffentliche Registrierung ist noch nicht freigeschaltet. Du kannst eine Demo anfragen." : message);
    } finally { setBusy(false); }
  }

  return <AuthShell>
    <div className={styles.page}>
      <PageHeader title="Leg los mit Loynara." description="Erstelle dein Konto. Danach richtest du dein erstes Treueprogramm ein." />
      <div className={styles.sheet}>
        <form className={`auth-form ${styles.form}`} onSubmit={submit}>
          <TextField label="Dein Name" autoComplete="name" autoCapitalize="words" enterKeyHint="next" value={name} onChange={e => setName(e.target.value)} required maxLength={120} placeholder="Vor- und Nachname" />
          <TextField label="E-Mail-Adresse" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} placeholder="du@geschaeft.de" />
          <TextField label="Passwort" type="password" autoComplete="new-password" enterKeyHint="next" value={password} onChange={e => { setPassword(e.target.value); setMismatch(false); }} required minLength={12} hint="Mindestens 12 Zeichen." />
          <TextField label="Passwort wiederholen" type="password" autoComplete="new-password" enterKeyHint="go" value={confirmation} onChange={e => { setConfirmation(e.target.value); setMismatch(false); }} required minLength={12}
            error={mismatch ? "Die Passwörter stimmen nicht überein." : undefined} />
          {error ? <p className={styles.alert} role="alert"><CircleAlert size={18} aria-hidden="true" />{error}</p> : null}
          <Button type="submit" size="lg" block loading={busy}>{busy ? "Konto wird erstellt …" : "Konto erstellen"}</Button>
          <p className={styles.note}>Es wird keine Zahlung ausgelöst. Die öffentliche Registrierung bleibt bis zur Freigabe durch Loynara gesperrt.</p>
        </form>
        <p className={styles.note}>Du hast schon ein Konto? <Link className={styles.link} href="/login">Anmelden</Link></p>
      </div>
    </div>
  </AuthShell>;
}
