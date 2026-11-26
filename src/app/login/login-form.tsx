"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { AuthShell } from "@/components/ui/auth-shell";
import { LegalLinks } from "@/components/ui/legal-links";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { TextField } from "@/components/ui/field";
import { useFormCheck } from "@/components/ui/form-check";
import { authClient } from "@/lib/auth-client";
import { passkeyCancelled } from "@/lib/passkey-names";
import { withInviteReturn } from "@/lib/invite-return";
import styles from "@/components/auth/auth.module.css";

export function LoginForm({ registrationOpen, next = null, verified = false }: { registrationOpen: boolean; next?: string | null; verified?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fields = useFormCheck({ "login-password": "Bitte gib dein Passwort ein." });
  // Until the page is interactive, a tap on "Anmelden" would submit the bare form natively and just reload the page, wiping the fields.
  const ready = useSyncExternalStore(() => () => undefined, () => true, () => false);
  // ENG-383: a passkey button for browsers that offer no passkey in the address field's autofill (Chrome on iOS).
  const passkeys = useSyncExternalStore(() => () => undefined, () => "PublicKeyCredential" in window, () => false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const prompting = useRef(false); // the button's prompt is open: the autofill starts no request of its own meanwhile

  /**
   * A passkey sign-in's answer, from the autofill or the button. Only one that left a session leads on: a cookie that did
   * not stick must not loop /login and /merchant (Design, #349 round 2). A closed prompt says nothing. `asked`: the person
   * pressed the button, so a failed request gets a word even when no passkey answered.
   */
  const settle = useCallback(async (result: Awaited<ReturnType<typeof authClient.signIn.passkey>> | null, asked: boolean): Promise<"cancelled" | "done" | "failed"> => {
    const answered = (result as { webauthn?: { response?: { id?: string } } } | null)?.webauthn;
    if (result?.error && passkeyCancelled(result.error)) return "cancelled";
    if (result?.data && !result.error) {
      if ((await authClient.getSession()).data?.session) { router.push(next ?? "/merchant"); router.refresh(); return "done"; }
      setError("Die Anmeldung konnte nicht bestätigt werden. Prüfe deine Verbindung und versuche es erneut.");
    } else if ((answered || asked) && result?.error) {
      // From the autofill only a passkey the person used gets a word; a failed options request on page load stays quiet.
      if (result.error.status === 429) setError("Zu viele Anmeldeversuche. Warte bitte etwas und versuche es erneut.");
      else if (result.error.status >= 500) setError("Die Anmeldung ist vorübergehend nicht möglich. Deine Angaben bleiben erhalten. Versuche es später erneut.");
      else {
        setError("Mit diesem Passkey ging es nicht. Melde dich mit deinem Passwort an.");
        const credentialId = answered?.response?.id;
        const signal = (globalThis.PublicKeyCredential as { signalUnknownCredential?: (options: { rpId: string; credentialId: string }) => Promise<void> } | undefined)?.signalUnknownCredential;
        if ("code" in result.error && result.error.code === "PASSKEY_NOT_FOUND" && credentialId && signal) await signal({ rpId: location.hostname, credentialId }).catch(() => undefined);
      }
    } else if (asked) setError("Die Anmeldung konnte nicht bestätigt werden. Prüfe deine Verbindung und versuche es erneut.");
    return "failed";
  }, [router, next]);

  // A saved passkey is offered in the address field's autofill (conditional mediation); the password form stays as it is.
  // A passkey that did not work (deleted by a password reset, removed elsewhere) says so in the form, is reported to the
  // phone as unknown where it can be, and the autofill is offered again.
  useEffect(() => {
    let active = true, failures = 0;
    const offer = async (): Promise<void> => {
      if (!await globalThis.PublicKeyCredential?.isConditionalMediationAvailable?.()) return;
      const result = prompting.current ? null : await authClient.signIn.passkey({ autoFill: true, returnWebAuthnResponse: true });
      if (!active) return;
      // While the button's prompt runs this request waits for the next focus of the address field, like a closed one.
      const outcome = result ? await settle(result, false) : "cancelled";
      if (outcome === "done") return;
      if (outcome === "cancelled") {
        // A closed prompt is not a failure and says nothing. It is offered again when the person comes back to the address
        // field, never at once: a browser that rejects an empty conditional request straight away would otherwise spin. The
        // passkey button's prompt ends this request the same way.
        const field = document.getElementById("login-email");
        const again = () => { field?.removeEventListener("focus", again); field?.removeEventListener("pointerdown", again); if (active) void offer().catch(() => undefined); };
        field?.addEventListener("focus", again); field?.addEventListener("pointerdown", again);
        return;
      }
      // A few more offers after a failure only: a request that fails without the person doing anything must not spin.
      if (active && (failures += 1) < 3) return offer();
    };
    void offer().catch(() => { /* no passkey offered: the password form is the way in */ });
    return () => { active = false; };
  }, [settle]);

  // The modal prompt. Starting it ends a pending autofill request first: the WebAuthn helper Better Auth uses aborts the
  // running call whenever a new one starts, and the browser allows only one at a time.
  async function signInWithPasskey() {
    if (passkeyBusy || busy) return;
    setPasskeyBusy(true); setError("");
    prompting.current = true;
    try {
      let result = await authClient.signIn.passkey({ returnWebAuthnResponse: true });
      // An autofill request whose options were still on their way when the button was pressed starts after it and ends
      // its prompt (Reviewer, #374). Once more then; the autofill waits from here. A closed sheet is NotAllowedError, so
      // this cannot loop.
      if (result?.error && "code" in result.error && result.error.code === "ERROR_CEREMONY_ABORTED") result = await authClient.signIn.passkey({ returnWebAuthnResponse: true });
      await settle(result, true);
    }
    catch { setError("Die Anmeldung konnte nicht bestätigt werden. Prüfe deine Verbindung und versuche es erneut."); }
    finally { prompting.current = false; setPasskeyBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The button only shows "loading" (it keeps focus), so Enter in a field would submit again: ignore it while a request runs.
    if (busy) return;
    const formElement = event.currentTarget;
    if (!fields.check(formElement)) return;
    // The fields are uncontrolled: text typed or autofilled before hydration finished is kept, where a controlled field
    // would be reset to its empty initial state and the browser's "required" check would then swallow the submit silently.
    const form = new FormData(formElement);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setBusy(true); setError("");
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        // HTTP rejection and lost transport have different certainty. Never display library diagnostics.
        if (result.error.code === "INVALID_EMAIL_OR_PASSWORD") {
          setError("E-Mail-Adresse oder Passwort stimmen nicht. Prüfe deine Angaben.");
          // The address is usually right: put the caret back into the password, ready to retype.
          const field = formElement.elements.namedItem("password");
          if (field instanceof HTMLInputElement) { field.focus(); field.select(); }
        }
        else if (result.error.status === 429) setError("Zu viele Anmeldeversuche. Warte bitte etwas und versuche es erneut.");
        else if (result.error.status >= 500 || result.error.code === "FAILED_TO_CREATE_SESSION") setError("Die Anmeldung ist vorübergehend nicht möglich. Deine Angaben bleiben erhalten. Versuche es später erneut.");
        else setError("Die Anmeldung wurde nicht bestätigt. Prüfe deine Angaben oder wende dich an Loynara.");
        return;
      }
      if (!result.data?.user) {
        setError("Die Anmeldung konnte nicht bestätigt werden. Prüfe deine Verbindung und versuche es erneut.");
        return;
      }
      router.push(next ?? "/merchant");
      router.refresh();
    } catch {
      setError("Die Anmeldung konnte nicht bestätigt werden. Prüfe deine Verbindung und versuche es erneut.");
    } finally { setBusy(false); }
  }

  // Design's screen 34 (ENG-122h): the mark alone, the larger question, the legal links right under the form, muted like
  // everywhere else (G-22: green is the one next step). Copy is live (R22).
  return <AuthShell mark footer={null}>
    <div className={styles.page}>
      <PageHeader className={styles.signin} title="Gut, dass du da bist." description={next === "/merchant/more" ? "Melde dich mit deinem Passwort an. Danach kannst du deinen Passkey hinzufügen." : "Melde dich an, um dein Treueprogramm und die Kasse zu öffnen."} />
      <div className={styles.sheet}>
        <form className={`auth-form ${styles.form}`} onSubmit={submit} onInput={fields.onInput} noValidate>
          {verified ? <p className={styles.alert} data-tone="ok" role="status"><CircleCheck size={20} aria-hidden="true" />Deine E-Mail-Adresse ist bestätigt.</p> : null}
          <TextField id="login-email" error={fields.error("login-email")} label="E-Mail-Adresse" type="email" name="email" autoComplete="username webauthn" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" required placeholder="du@geschaeft.de" />
          <TextField id="login-password" error={fields.error("login-password")} label="Passwort" type="password" name="password" autoComplete="current-password" enterKeyHint="go" required />
          <Link className={styles.forgot} href="/forgot-password">Passwort vergessen?</Link>
          {error ? <p className={styles.alert} role="alert"><CircleAlert size={20} aria-hidden="true" />{error}</p> : null}
          <Button type="submit" block loading={busy} disabled={!ready}>{busy ? "Anmeldung läuft …" : "Anmelden"}</Button>
        </form>
        {passkeys ? <Button variant="secondary" block loading={passkeyBusy} disabled={!ready} onClick={() => void signInWithPasskey()}>{passkeyBusy ? "Passkey wird geprüft …" : "Mit Passkey anmelden"}</Button> : null}
        <p className={styles.note}>{registrationOpen
          ? <>Noch kein Konto? <Link className={styles.link} href={withInviteReturn("/register", next)}>Konto erstellen</Link></>
          : <>Noch keinen Zugang? Loynara richtet ihn gemeinsam mit dir ein.</>}</p>
      </div>
      <LegalLinks />
    </div>
  </AuthShell>;
}
