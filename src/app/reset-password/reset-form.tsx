"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { CircleAlert } from "lucide-react";
import { AuthShell } from "@/components/ui/auth-shell";
import { Button, buttonClassName } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { TextField } from "@/components/ui/field";
import { useFormCheck } from "@/components/ui/form-check";
import { authClient } from "@/lib/auth-client";
import styles from "@/components/auth/auth.module.css";
import { CONNECTION_LOST, PASSWORD_MAX, PASSWORD_MIN } from "@/components/auth/auth-errors";

const EXPIRED = "Dieser Link gilt nicht mehr. Er läuft nach einer Stunde ab und funktioniert nur einmal.";

// ENG-279: the page the reset mail links to. The token is the link's; the server checks it again.
export function ResetForm({ token }: { token: string }) {
  const ready = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [error, setError] = useState(token ? "" : EXPIRED);
  const fields = useFormCheck();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !fields.check(event.currentTarget)) return;
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("password") ?? "");
    if (newPassword !== String(form.get("confirmation") ?? "")) { setMismatch(true); return; }
    setError("");
    setBusy(true);
    try {
      const { error: failed } = await authClient.resetPassword({ newPassword, token });
      if (!failed) setDone(true);
      else setError(failed.status === 429 ? "Zu viele Versuche. Warte bitte etwas und versuche es erneut." : failed.status === 400 && failed.code !== "PASSWORD_TOO_SHORT" && failed.code !== "PASSWORD_TOO_LONG" ? EXPIRED : "Das Passwort wurde nicht geändert. Prüfe deine Angaben und versuche es erneut.");
    } catch { setError(CONNECTION_LOST); }
    finally { setBusy(false); }
  }

  if (done) return <AuthShell>
    <div className={styles.page}>
      <PageHeader title="Dein Passwort ist geändert." description="Du bist auf allen Geräten abgemeldet. Melde dich jetzt mit dem neuen Passwort an." />
      <Link href="/login" className={buttonClassName({ block: true })}>Anmelden</Link>
    </div>
  </AuthShell>;

  return <AuthShell>
    <div className={styles.page}>
      <PageHeader title="Neues Passwort festlegen." description={`Mindestens ${PASSWORD_MIN}, höchstens ${PASSWORD_MAX} Zeichen.`} />
      <div className={styles.sheet}>
        <form className={`auth-form ${styles.form}`} onSubmit={submit} onInput={fields.onInput} noValidate>
          <TextField id="rp-password" error={fields.error("rp-password")} label="Neues Passwort" type="password" name="password" autoComplete="new-password" enterKeyHint="next" onChange={() => setMismatch(false)} required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} />
          <TextField id="rp-confirmation" label="Passwort wiederholen" type="password" name="confirmation" autoComplete="new-password" enterKeyHint="go" onChange={() => setMismatch(false)} required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX}
            error={fields.error("rp-confirmation") ?? (mismatch ? "Die Passwörter stimmen nicht überein." : undefined)} />
          {error ? <p className={styles.alert} role="alert"><CircleAlert size={20} aria-hidden="true" />{error}</p> : null}
          <Button type="submit" block loading={busy} disabled={!ready || !token}>{busy ? "Wird gespeichert …" : "Passwort speichern"}</Button>
        </form>
        <p className={styles.note}><Link className={styles.link} href="/forgot-password">Neuen Link anfordern</Link></p>
      </div>
    </div>
  </AuthShell>;
}
