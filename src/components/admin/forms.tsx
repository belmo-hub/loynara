"use client";
import { useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import QRCode from "qrcode";
import { authClient } from "@/lib/auth-client";
import { sanitizeAdminNext } from "./paths";
const message = "Das hat nicht geklappt. Bitte prüfe deine Angaben und versuche es erneut.";
function ErrorMessage({ value }: { value: string }) { return value ? <p role="alert">{value}</p> : null; }
export function AdminSignOut() {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function signOut() {
    setBusy(true); setError("");
    try { const result = await authClient.signOut(); if (result.error) throw new Error(); window.location.replace("/admin/sign-in"); }
    catch { setError("Abmelden fehlgeschlagen. Bitte versuche es erneut."); setBusy(false); }
  }
  return <div><button className="ow-btn ow-btn--secondary" type="button" disabled={busy} onClick={() => void signOut()}>{busy ? "Abmeldung läuft …" : "Abmelden"}</button><ErrorMessage value={error} /></div>;
}
export function SignInForm() {
  const [factor, setFactor] = useState(false), [backup, setBackup] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError("");
    try {
      if (!factor) {
        const result = await authClient.signIn.email({ email: String(form.get("email")), password: String(form.get("password")) });
        if (result.error) throw new Error();
        if (result.data && "twoFactorRedirect" in result.data && result.data.twoFactorRedirect) { setFactor(true); return; }
      } else {
        const code = String(form.get("code")).trim();
        const result = backup ? await authClient.twoFactor.verifyBackupCode({ code }) : await authClient.twoFactor.verifyTotp({ code });
        if (result.error) throw new Error();
      }
      window.location.replace("/admin");
    } catch { setError(message); } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="ow-stack" style={{ maxWidth: 480 }}>
    {!factor ? <><div className="ow-field"><label htmlFor="admin-email">E-Mail</label><input className="ow-input" id="admin-email" name="email" type="email" autoComplete="username" required /></div><div className="ow-field"><label htmlFor="admin-password">Passwort</label><input className="ow-input" id="admin-password" name="password" type="password" autoComplete="current-password" required /></div></> : <><div className="ow-field"><label htmlFor="admin-code">{backup ? "Backup-Code" : "Code aus der Authenticator-App"}</label><input className="ow-input" id="admin-code" name="code" autoComplete="one-time-code" inputMode={backup ? "text" : "numeric"} pattern={backup ? undefined : "[0-9]{6}"} required /></div><button type="button" className="ow-btn ow-btn--ghost" onClick={() => { setBackup(!backup); setError(""); }}>{backup ? "Authenticator-Code verwenden" : "Backup-Code verwenden"}</button></>}
    <ErrorMessage value={error} /><button className="ow-btn ow-btn--primary" disabled={busy}>{busy ? "Wird geprüft …" : factor ? "Anmeldung bestätigen" : "Anmelden"}</button>
  </form>;
}
export function EnrollmentForm() {
  const [setup, setSetup] = useState<{ uri: string; qr: string; codes: string[] } | null>(null), [confirmed, setConfirmed] = useState(false), [saved, setSaved] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function enable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError("");
    try {
      const result = await authClient.twoFactor.enable({ password: String(data.get("password")) });
      if (result.error || !result.data || result.data.method !== "totp") throw new Error();
      setSetup({ uri: result.data.totpURI, qr: await QRCode.toDataURL(result.data.totpURI, { width: 240, margin: 2 }), codes: result.data.backupCodes });
    } catch { setError(message); } finally { setBusy(false); }
  }
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError("");
    try { const result = await authClient.twoFactor.verifyTotp({ code: String(data.get("code")).trim() }); if (result.error) throw new Error(); setConfirmed(true); }
    catch { setError(message); } finally { setBusy(false); }
  }
  if (confirmed && setup) return <section className="ow-stack"><h2>Backup-Codes sicher aufbewahren</h2><p>Diese zehn Codes werden nur jetzt angezeigt. Jeder Code kann einmal verwendet werden. Drucke sie aus oder bewahre sie offline sicher auf.</p><ul>{setup.codes.map(code => <li key={code}><code>{code}</code></li>)}</ul><label><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)} /> Ich habe die Backup-Codes sicher gespeichert.</label><button type="button" className="ow-btn ow-btn--primary" disabled={!saved} onClick={() => { setSetup(null); window.location.replace("/admin"); }}>Zur Konsole</button></section>;
  return <section className="ow-stack" style={{ maxWidth: 520 }}>{!setup ? <form onSubmit={enable} className="ow-stack"><p>Bestätige dein Passwort, um deine Authenticator-App einzurichten.</p><div className="ow-field"><label htmlFor="enroll-password">Passwort</label><input className="ow-input" id="enroll-password" name="password" type="password" autoComplete="current-password" required /></div><button className="ow-btn ow-btn--primary" disabled={busy}>{busy ? "Wird vorbereitet …" : "Authenticator einrichten"}</button></form> : <form onSubmit={verify} className="ow-stack"><p>Scanne den QR-Code mit deiner Authenticator-App und gib den angezeigten Code ein.</p><Image src={setup.qr} width={240} height={240} alt="QR-Code zum Einrichten deiner Authenticator-App" unoptimized /><details><summary>Manuell einrichten</summary><p style={{ overflowWrap: "anywhere" }}>Schlüssel: <code>{new URL(setup.uri).searchParams.get("secret")}</code></p></details><div className="ow-field"><label htmlFor="enroll-code">Authenticator-Code</label><input className="ow-input" id="enroll-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required /></div><button className="ow-btn ow-btn--primary" disabled={busy}>{busy ? "Wird geprüft …" : "Code bestätigen"}</button></form>}<ErrorMessage value={error} /></section>;
}
export function StepUpForm({ next }: { next: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError("");
    try {
      const result = await fetch("/api/admin/step-up", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: String(data.get("password")), code: String(data.get("code")).trim() }) });
      if (!result.ok) { if (result.status === 429) { setError("Zu viele Versuche. Bitte warte 15 Minuten."); return; } throw new Error(); }
      window.location.replace(sanitizeAdminNext(next));
    } catch { setError(message); } finally { setBusy(false); }
  }
  return <form className="ow-stack" onSubmit={submit} style={{ maxWidth: 480 }}><div className="ow-field"><label htmlFor="step-password">Passwort</label><input id="step-password" className="ow-input" name="password" type="password" autoComplete="current-password" required /></div><div className="ow-field"><label htmlFor="step-code">Authenticator-Code</label><input id="step-code" className="ow-input" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required /></div><ErrorMessage value={error} /><button className="ow-btn ow-btn--primary" disabled={busy}>{busy ? "Wird geprüft …" : "Anmeldung erneut bestätigen"}</button></form>;
}
export function ResetFactorButton({ userId }: { userId: string }) {
  const key = useRef<string | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [stepUp, setStepUp] = useState(false), [done, setDone] = useState(false), [confirmed, setConfirmed] = useState(false);
  async function reset() {
    key.current ??= crypto.randomUUID(); setBusy(true); setError(""); setStepUp(false);
    try {
      const result = await fetch(`/api/admin/admins/${encodeURIComponent(userId)}/reset-2fa`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: key.current }) });
      if (!result.ok) { const body = await result.json(); if (body.code === "STEP_UP_REQUIRED") { setStepUp(true); return; } throw new Error(); }
      setDone(true);
    } catch { setError("Zurücksetzen nicht bestätigt. Du kannst denselben Vorgang erneut versuchen."); } finally { setBusy(false); }
  }
  if (done) return <p role="status">Zweiter Faktor zurückgesetzt. Alle Sitzungen dieses Kontos sind beendet.</p>;
  return <div className="ow-stack">{!confirmed ? <button type="button" className="ow-btn ow-btn--secondary" onClick={() => setConfirmed(true)}>Zweiten Faktor zurücksetzen</button> : <><p>Alle Sitzungen dieses Kontos werden beendet. Die Person muss ihren Authenticator neu einrichten.</p><div className="ow-row"><button type="button" className="ow-btn ow-btn--danger" disabled={busy} onClick={() => void reset()}>{busy ? "Wird zurückgesetzt …" : "Zurücksetzen bestätigen"}</button><button type="button" className="ow-btn ow-btn--ghost" disabled={busy} onClick={() => setConfirmed(false)}>Abbrechen</button></div></>}<ErrorMessage value={error} />{stepUp && <Link className="ow-btn ow-btn--secondary" href="/admin/step-up?next=%2Fadmin%2Fteam">Anmeldung erneut bestätigen</Link>}</div>;
}
