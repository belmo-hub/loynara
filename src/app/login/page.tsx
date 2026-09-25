"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { Icon } from "@/components/loyalty-ui";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const result = await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) throw new Error(result.error.message || "Anmeldung fehlgeschlagen.");
      router.push("/merchant");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Anmeldung fehlgeschlagen.");
    } finally { setBusy(false); }
  }

  return <AuthFrame eyebrow="WILLKOMMEN ZURÜCK" title="Gut, dass du da bist." description="Melde dich an und arbeite an deinem Programm weiter." footer={<>Noch kein Konto? <Link href="/register">Konto erstellen</Link></>}><form className="auth-form" onSubmit={submit}><label>E-Mail-Adresse<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="du@geschaeft.de" /></label><label>Passwort<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Dein Passwort" /></label>{error && <p className="auth-error" role="alert">{error}</p>}<button type="submit" className="button button--ink button--full" disabled={busy}>{busy ? "Anmeldung läuft …" : "Anmelden"}<Icon name="arrow" size={18} /></button></form></AuthFrame>;
}
