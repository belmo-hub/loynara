"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { AuthFrame } from "@/components/auth-frame";
import { Icon } from "@/components/loyalty-ui";
import { authClient } from "@/lib/auth-client";

export function LoginForm({ registrationOpen }: { registrationOpen: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Until the page is interactive, a tap on "Anmelden" would submit the bare form natively and just reload the page, wiping the fields.
  const ready = useSyncExternalStore(() => () => undefined, () => true, () => false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The fields are uncontrolled: text typed or autofilled before hydration finished is kept, where a controlled field
    // would be reset to its empty initial state and the browser's "required" check would then swallow the submit silently.
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setBusy(true); setError("");
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) throw new Error(result.error.message || "Anmeldung fehlgeschlagen.");
      router.push("/merchant");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Anmeldung fehlgeschlagen.");
    } finally { setBusy(false); }
  }

  return <AuthFrame eyebrow="WILLKOMMEN ZURÜCK" title="Gut, dass du da bist." description="Melde dich an und arbeite an deinem Programm weiter." footer={registrationOpen ? <>Noch kein Konto? <Link href="/register">Konto erstellen</Link></> : <>Noch keinen Zugang? Dein Zugang wird von Loynara für dich eingerichtet.</>}><form className="auth-form" onSubmit={submit}><label>E-Mail-Adresse<input type="email" name="email" autoComplete="email" required placeholder="du@geschaeft.de" /></label><label>Passwort<input type="password" name="password" autoComplete="current-password" required placeholder="Dein Passwort" /></label>{error && <p className="auth-error" role="alert">{error}</p>}<button type="submit" className="button button--ink button--full" disabled={busy || !ready}>{busy ? "Anmeldung läuft …" : "Anmelden"}<Icon name="arrow" size={18} /></button></form></AuthFrame>;
}
