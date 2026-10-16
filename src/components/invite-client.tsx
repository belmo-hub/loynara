"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { CircleAlert } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { postJson } from "./client-api";
import { AuthShell } from "./ui/auth-shell";
import { Button, buttonClassName } from "./ui/button";
import { PageHeader } from "./ui/page-header";
import { TextField } from "./ui/field";
import styles from "./auth/auth.module.css";
import { CONNECTION_LOST, inviteAcceptMessage, PASSWORD_MAX, PASSWORD_MIN, signUpMessage } from "./auth/auth-errors";

type InvitePreview = { email: string; role: "cashier" | "manager"; businessName: string; locationName: string };

function Alert({ children }: { children: string }) {
  return <p className={styles.alert} role="alert"><CircleAlert size={18} aria-hidden="true" />{children}</p>;
}

export function InviteClient({ token, registrationOpen = true, invite }: { token: string; registrationOpen?: boolean; invite?: InvitePreview }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [mismatch, setMismatch] = useState(false);
  // Until the page is interactive, a tap would submit the bare form natively and reload it, wiping the fields.
  const ready = useSyncExternalStore(() => () => undefined, () => true, () => false);
  // Set once the account exists, so a retry after a failed acceptance does not try to create it again.
  const accountCreated = useRef(false);

  async function accept() {
    if (busy) return;
    setBusy(true); setError("");
    try { await postJson("/api/staff/accept", { token }); setDone(true); }
    catch (cause) { setError(inviteAcceptMessage(cause)); }
    finally { setBusy(false); }
  }

  // Invite-gated sign-up: the account is created for the invited address only; the server checks the token again.
  async function createAndAccept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invite || busy) return;
    // Uncontrolled fields: values typed or autofilled before hydration finished are read here, not lost.
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim(), password = String(form.get("password") ?? ""), confirmation = String(form.get("confirmation") ?? "");
    setError("");
    if (password !== confirmation) { setMismatch(true); return; }
    setBusy(true);
    try {
      if (!accountCreated.current) {
        let result: Awaited<ReturnType<typeof authClient.signUp.email>>;
        try { result = await authClient.signUp.email({ name, email: invite.email, password, fetchOptions: { headers: { "x-loynara-invite": token } } }); }
        catch { setError(CONNECTION_LOST); return; }
        if (result.error) { setError(signUpMessage(result.error, "invite")); return; }
        accountCreated.current = true;
      }
      try { await postJson("/api/staff/accept", { token }); setDone(true); }
      catch (cause) { setError(inviteAcceptMessage(cause)); }
    } finally { setBusy(false); }
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
            <TextField label="Dein Name" name="name" autoComplete="name" autoCapitalize="words" enterKeyHint="next" required maxLength={120} placeholder="Vor- und Nachname" />
            <TextField label="Passwort" type="password" name="password" autoComplete="new-password" enterKeyHint="next" onChange={() => setMismatch(false)} required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} hint={`Mindestens ${PASSWORD_MIN}, höchstens ${PASSWORD_MAX} Zeichen.`} />
            <TextField label="Passwort wiederholen" type="password" name="confirmation" autoComplete="new-password" enterKeyHint="go" onChange={() => setMismatch(false)} required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX}
              error={mismatch ? "Die Passwörter stimmen nicht überein." : undefined} />
            {error ? <Alert>{error}</Alert> : null}
            <Button type="submit" size="lg" block loading={busy} disabled={!ready}>{busy ? "Zugang wird eingerichtet …" : "Zugang einrichten"}</Button>
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
