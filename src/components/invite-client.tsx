"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { CircleAlert } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { postJson } from "./client-api";
import { AuthShell } from "./ui/auth-shell";
import { Button, buttonClassName } from "./ui/button";
import { PageHeader } from "./ui/page-header";
import { TextField } from "./ui/field";
import styles from "./auth/auth.module.css";

type InvitePreview = { email: string; role: "cashier" | "manager"; businessName: string; locationName: string };

function Alert({ children }: { children: string }) {
  return <p className={styles.alert} role="alert"><CircleAlert size={18} aria-hidden="true" />{children}</p>;
}

export function InviteClient({ token, registrationOpen = true, invite }: { token: string; registrationOpen?: boolean; invite?: InvitePreview }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  async function accept() {
    if (busy) return;
    setBusy(true); setError("");
    try { await postJson("/api/staff/accept", { token }); setDone(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Einladung konnte nicht angenommen werden."); }
    finally { setBusy(false); }
  }

  // Invite-gated sign-up: the account is created for the invited address only; the server checks the token again.
  async function createAndAccept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invite || busy) return;
    setError("");
    if (password !== confirmation) { setMismatch(true); return; }
    setBusy(true);
    try {
      const result = await authClient.signUp.email({ name: name.trim(), email: invite.email, password, fetchOptions: { headers: { "x-loynara-invite": token } } });
      if (result.error) throw new Error(/already exists/i.test(result.error.message ?? "") ? "Für diese Adresse gibt es schon ein Konto. Melde dich an und nimm die Einladung dann an." : result.error.message || "Konto konnte nicht erstellt werden.");
      await postJson("/api/staff/accept", { token });
      setDone(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Konto konnte nicht erstellt werden."); }
    finally { setBusy(false); }
  }

  if (done) return <AuthShell>
    <div className={`invite-card ${styles.page}`}>
      <PageHeader title="Willkommen im Team." description={`${invite ? `Dein Zugang für ${invite.locationName} ist aktiv.` : "Dein Teamzugang ist aktiv."} An der Kasse buchst du ab jetzt Besuche und Prämien.`} />
      <Link href="/cashier" className={buttonClassName({ size: "lg", block: true })}>Zur Kasse</Link>
    </div>
  </AuthShell>;

  const roleLabel = invite?.role === "manager" ? "Leitung" : "Kasse";
  return <AuthShell>
    <div className={`invite-card ${styles.page}`}>
      {invite ? <>
        <PageHeader title={`Dein Zugang für ${invite.businessName}`} description="Lege dein eigenes Konto an. So muss niemand im Team Zugangsdaten teilen." />
        <dl className={styles.summary}>
          <div><dt>Geschäft</dt><dd>{invite.businessName}</dd></div>
          <div><dt>Standort</dt><dd>{invite.locationName}</dd></div>
          <div><dt>Deine Rolle</dt><dd>{roleLabel}</dd></div>
        </dl>
        <div className={styles.sheet}>
          <form className={`auth-form ${styles.form}`} onSubmit={createAndAccept}>
            {/* Read-only, but marked "username" so the password manager files the new password under the invited address. */}
            <TextField label="E-Mail-Adresse" type="email" value={invite.email} readOnly aria-readonly="true" autoComplete="username" hint="Die Einladung gilt nur für diese Adresse." />
            <TextField label="Dein Name" autoComplete="name" autoCapitalize="words" enterKeyHint="next" value={name} onChange={e => setName(e.target.value)} required maxLength={120} placeholder="Vor- und Nachname" />
            <TextField label="Passwort" type="password" autoComplete="new-password" enterKeyHint="next" value={password} onChange={e => { setPassword(e.target.value); setMismatch(false); }} required minLength={12} hint="Mindestens 12 Zeichen." />
            <TextField label="Passwort wiederholen" type="password" autoComplete="new-password" enterKeyHint="go" value={confirmation} onChange={e => { setConfirmation(e.target.value); setMismatch(false); }} required minLength={12}
              error={mismatch ? "Die Passwörter stimmen nicht überein." : undefined} />
            {error ? <Alert>{error}</Alert> : null}
            <Button type="submit" size="lg" block loading={busy}>{busy ? "Zugang wird eingerichtet …" : "Zugang einrichten"}</Button>
          </form>
        </div>
        <div className={styles.alternative}>
          <p className={styles.note}>Schon ein Konto mit dieser Adresse? Melde dich an, öffne diesen Link danach noch einmal und nimm die Einladung hier an.</p>
          <div className={styles.actions}>
            <Link className={styles.link} href="/login">Zur Anmeldung</Link>
            <Button variant="quiet" size="sm" onClick={accept} loading={busy}>Angemeldet: Einladung annehmen</Button>
          </div>
        </div>
      </> : <>
        <PageHeader title="Deine Teameinladung" description="Melde dich mit der E-Mail-Adresse an, an die diese Einladung ging. Danach nimmst du sie hier an." />
        <div className={styles.sheet}>
          {error ? <Alert>{error}</Alert> : null}
          <Button size="lg" block onClick={accept} loading={busy}>{busy ? "Einladung wird geprüft …" : "Einladung annehmen"}</Button>
          <p className={styles.note}>Noch nicht angemeldet? <Link className={styles.link} href="/login">Zur Anmeldung</Link>{registrationOpen ? <> oder <Link className={styles.link} href="/register">Konto erstellen</Link></> : null}</p>
        </div>
      </>}
    </div>
  </AuthShell>;
}
