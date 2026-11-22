"use client";

import { KeyRound, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiJson, postJson } from "@/components/client-api";
import { authClient } from "@/lib/auth-client";

type Passkey = { id: string; name?: string | null; createdAt?: string | null };
const LIST = "/api/auth/passkey/list-user-passkeys";
const added = (iso?: string | null) => iso ? `Hinzugefügt am ${new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso))}` : undefined;

/**
 * Optional passkeys under „Konto“ (web audit finding 10): sign in with the phone's lock instead of the password. The
 * password keeps working; a passkey is only added when the person asks, and removed with one tap.
 */
export function PasskeyRows() {
  const [keys, setKeys] = useState<Passkey[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ text: "", error: false });
  const supported = typeof window !== "undefined" && "PublicKeyCredential" in window;
  const load = useCallback(() => apiJson<Passkey[]>(LIST).then(setKeys, () => setKeys([])), []);
  useEffect(() => { if (supported) void load(); }, [supported, load]);

  async function add() {
    if (busy) return;
    setBusy(true); setMessage({ text: "", error: false });
    const result = await authClient.passkey.addPasskey().catch(() => null);
    setBusy(false);
    // A closed system prompt is the person's choice, not a fault: the browser's WebAuthn errors carry a code.
    const cancelled = result?.error && "code" in result.error && /CANCELLED|ABORTED|NOT_ALLOWED/.test(result.error.code);
    if (cancelled) return;
    if (!result || result.error) return setMessage({ text: "Der Passkey wurde nicht gespeichert. Versuche es noch einmal.", error: true });
    setMessage({ text: "Passkey gespeichert. Du kannst dich jetzt damit anmelden.", error: false });
    void load();
  }
  async function remove(key: Passkey) {
    setBusy(true);
    try { await postJson("/api/auth/passkey/delete-passkey", { id: key.id }); setMessage({ text: "Passkey entfernt.", error: false }); }
    catch { setMessage({ text: "Der Passkey wurde nicht entfernt. Versuche es noch einmal.", error: true }); }
    finally { setBusy(false); void load(); }
  }

  if (!supported || keys === null) return null;
  return <>
    {keys.map(key => <div key={key.id} className="ow-prog-row">
      <span className="ow-prog-icon"><KeyRound size={22} aria-hidden="true" /></span>
      <span className="ow-prog-main"><span className="ow-prog-text"><strong>{key.name || "Passkey"}</strong>{added(key.createdAt) && <small>{added(key.createdAt)}</small>}</span></span>
      <button type="button" className="ow-btn ow-btn--secondary" disabled={busy} onClick={() => void remove(key)}>Entfernen</button>
    </div>)}
    <button type="button" className="ow-prog-row" aria-busy={busy} onClick={() => void add()}>
      <span className="ow-prog-icon"><Plus size={22} aria-hidden="true" /></span>
      <span className="ow-prog-main"><span className="ow-prog-text"><strong>Passkey hinzufügen</strong><small>Mit Face ID, Fingerabdruck oder Display-Sperre anmelden, ohne Passwort.</small></span></span>
    </button>
    <p className={message.error ? "ow-error" : "ow-sr"} role={message.error ? "alert" : "status"}>{message.text}</p>
  </>;
}
