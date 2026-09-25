"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { Icon } from "@/components/loyalty-ui";
import { authClient } from "@/lib/auth-client";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password !== confirmation) { setError("Die Passwörter stimmen nicht überein."); return; }
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

  return <AuthFrame eyebrow="KONTO ERSTELLEN" title="Leg los mit LoopLocal." description="Erstelle dein Konto. Danach richtest du dein erstes Treueprogramm ein." footer={<>Du hast schon ein Konto? <Link href="/login">Anmelden</Link></>}><form className="auth-form" onSubmit={submit}><label>Dein Name<input autoComplete="name" value={name} onChange={e => setName(e.target.value)} required maxLength={120} placeholder="Vor- und Nachname" /></label><label>E-Mail-Adresse<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={254} placeholder="du@geschaeft.de" /></label><label>Passwort<input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={12} placeholder="Mindestens 12 Zeichen" /></label><label>Passwort wiederholen<input type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} required minLength={12} placeholder="Passwort bestätigen" /></label>{error && <p className="auth-error" role="alert">{error}</p>}<button type="submit" className="button button--ink button--full" disabled={busy}>{busy ? "Konto wird erstellt …" : "Konto erstellen"}<Icon name="arrow" size={18} /></button><p className="auth-disclaimer">Keine Zahlung wird ausgelöst. Öffentliche Registrierung ist bis zur Betreiberfreigabe gesperrt.</p></form></AuthFrame>;
}
