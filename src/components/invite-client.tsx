"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { postJson } from "./client-api";
import { BrandMark, Icon } from "./loyalty-ui";

type InvitePreview = { email: string; role: "cashier" | "manager"; businessName: string; locationName: string };

export function InviteClient({ token, registrationOpen = true, invite }: { token: string; registrationOpen?: boolean; invite?: InvitePreview }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  async function accept() {
    setBusy(true); setError("");
    try { await postJson("/api/staff/accept", { token }); setDone(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Einladung konnte nicht angenommen werden."); }
    finally { setBusy(false); }
  }

  // Invite-gated sign-up: the account is created for the invited address only; the server checks the token again.
  async function createAndAccept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invite) return;
    setError("");
    if (password !== confirmation) { setError("Die Passwörter stimmen nicht überein."); return; }
    setBusy(true);
    try {
      const result = await authClient.signUp.email({ name: name.trim(), email: invite.email, password, fetchOptions: { headers: { "x-loynara-invite": token } } });
      if (result.error) throw new Error(/already exists/i.test(result.error.message ?? "") ? "Für diese Adresse gibt es schon ein Konto. Melde dich an und nimm die Einladung dann an." : result.error.message || "Konto konnte nicht erstellt werden.");
      await postJson("/api/staff/accept", { token });
      setDone(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Konto konnte nicht erstellt werden."); }
    finally { setBusy(false); }
  }

  const roleLabel = invite?.role === "manager" ? "Leitung" : "Kasse";
  return <main className="invite-page"><div className="invite-card"><Link href="/"><BrandMark /></Link><span className="eyebrow"><span className="eyebrow-dot" /> TEAMEINLADUNG</span>
    <h1>{done ? "Willkommen im Team." : "Dein Zugang zum Tresen."}</h1>
    {done ? <><p>Dein Teamzugang ist aktiv. Du kannst dich zur Kassenansicht begeben.</p><Link href="/cashier" className="button button--ink">Zur Kasse <Icon name="arrow" size={17} /></Link></>
      : invite ? <>
        <p>{invite.businessName} lädt dich als <strong>{roleLabel}</strong> für {invite.locationName} ein. Lege dein eigenes Konto an; das Inhaberkonto wird nie geteilt.</p>
        <form className="auth-form" onSubmit={createAndAccept}>
          <label>E-Mail-Adresse<input value={invite.email} readOnly aria-readonly="true" /></label>
          <label>Dein Name<input autoComplete="name" value={name} onChange={e => setName(e.target.value)} required maxLength={120} placeholder="Vor- und Nachname" /></label>
          <label>Passwort<input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={12} placeholder="Mindestens 12 Zeichen" /></label>
          <label>Passwort wiederholen<input type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} required minLength={12} placeholder="Passwort bestätigen" /></label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="submit" className="button button--ink button--full" disabled={busy}>{busy ? "Zugang wird eingerichtet …" : "Konto erstellen und Einladung annehmen"}<Icon name="arrow" size={17} /></button>
        </form>
        <div className="invite-links"><span>Schon ein Konto mit dieser Adresse?</span><Link href="/login">Einloggen</Link><button type="button" className="text-button" onClick={accept} disabled={busy}>Dann hier annehmen</button></div>
      </>
      : <><p>Melde dich mit genau der E-Mail-Adresse an, an die diese Einladung adressiert wurde. Danach kannst du sie hier annehmen.</p>{error && <p className="auth-error" role="alert">{error}</p>}<button type="button" className="button button--ink" onClick={accept} disabled={busy}>{busy ? "Einladung wird geprüft …" : "Einladung annehmen"}<Icon name="arrow" size={17} /></button><div className="invite-links"><Link href="/login">Einloggen</Link>{registrationOpen && <Link href="/register">Konto erstellen</Link>}</div></>}
  </div></main>;
}
