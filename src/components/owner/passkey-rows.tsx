"use client";

import { KeyRound, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { apiJson, postJson } from "@/components/client-api";
import { authClient } from "@/lib/auth-client";
import { germanDate, shopZone } from "@/lib/german-date";
import { passkeyCancelled } from "@/lib/passkey-names";
import { Confirm } from "./owner-rows";
import { useOwner } from "./owner-context";

type Passkey = { id: string; name?: string | null; createdAt?: string | null };
type Note = { tone?: "error" | "ok"; text: ReactNode } | null;
const LIST = "/api/auth/passkey/list-user-passkeys";
const ADD_ID = "passkey-add";
const SUB = "Melde dich mit Face ID, Fingerabdruck oder Displaysperre an. Dein Passwort bleibt.";
// The row add/remove motion (Design R3): a removed row closes over 160 ms before the list drops it.
const CLOSE_MS = 160;
const still = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const never = () => () => {};
/** Owners and managers on their own phones; never the Kasse's shared device (Design R1, CTO, 23 Nov; the server refuses too). */
export const passkeysFor = (role: string | undefined) => role === "owner" || role === "manager";

/**
 * Optional passkeys under „Konto“ for owners and managers (web audit finding 10; Design, #349 round 2). One keyed row per
 * passkey and the add row, for the Konto Rows; the outcome goes in the Rows note; removing goes through the house Confirm,
 * which the page shows instead of the list while it is open. Cashiers get nothing: the Kasse is a shared device.
 */
export function usePasskeyRows(): { rows: ReactNode[]; note: Note; confirm: ReactNode } {
  const owner = useOwner();
  const router = useRouter();
  const zone = shopZone(owner);
  const allowed = passkeysFor(owner.me?.role);
  const supported = useSyncExternalStore(never, () => "PublicKeyCredential" in window, () => false);
  const [keys, setKeys] = useState<Passkey[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [removing, setRemoving] = useState<Passkey | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [known, setKnown] = useState<Set<string> | null>(null);
  const focusNext = useRef<string | null>(null);

  const load = useCallback(() => apiJson<Passkey[]>(LIST).then(list => {
    // Rows of the first answer stand still; a row added later opens (Design R3).
    setKnown(current => current ?? new Set(list.map(key => key.id)));
    setKeys(list);
  }, () => setKeys([])), []);
  /** Signs out and comes back to Konto after signing in again: adding a passkey needs a sign-in from the last 10 minutes. */
  async function signInAgain() {
    await authClient.signOut().catch(() => undefined);
    owner.resetAfterSignOut();
    router.push(`/login?next=${encodeURIComponent("/merchant/more")}`);
  }
  useEffect(() => { if (supported && allowed) void load(); }, [supported, allowed, load]);
  // After a removal the focus goes to the next row's „Entfernen“, else to „Passkey hinzufügen“, never to the page.
  useEffect(() => {
    if (!focusNext.current || removing) return;
    const target = document.getElementById(focusNext.current);
    if (target) { target.focus(); focusNext.current = null; }
  });

  async function add() {
    if (busy) return;
    setBusy(true); setNote(null);
    const spin = window.setTimeout(() => setSpinning(true), 300);
    const result = await authClient.passkey.addPasskey().catch(() => null);
    window.clearTimeout(spin); setSpinning(false); setBusy(false);
    if (result && !result.error) { setNote({ tone: "ok", text: "Passkey hinzugefügt. Du kannst dich jetzt damit anmelden." }); void load(); return; }
    // A closed system prompt is the person's choice: nothing to say.
    if (result?.error && passkeyCancelled(result.error)) return;
    // Adding one needs a sign-in from the last 10 minutes (auth.ts): a neutral step, not an error.
    if (result?.error?.status === 403) {
      setNote({ text: <>Zum Hinzufügen meldest du dich einmal neu an. <button type="button" className="ow-btn ow-btn--secondary ow-btn--sm ow-note-action" onClick={() => void signInAgain()}>Neu anmelden</button></> });
      return;
    }
    setNote({ tone: "error", text: "Der Passkey wurde nicht gespeichert. Versuche es noch einmal." });
  }

  async function remove(key: Passkey) {
    setBusy(true);
    try {
      await postJson("/api/auth/passkey/delete-passkey", { id: key.id });
      const list = keys ?? [];
      const next = list[list.findIndex(item => item.id === key.id) + 1];
      focusNext.current = next ? `passkey-remove-${next.id}` : ADD_ID;
      setNote({ tone: "ok", text: "Passkey entfernt." });
      setRemoving(null);
      if (still()) void load();
      else { setClosing(key.id); window.setTimeout(() => { setClosing(null); void load(); }, CLOSE_MS); }
    } catch {
      setRemoving(null);
      focusNext.current = `passkey-remove-${key.id}`;
      setNote({ tone: "error", text: "Der Passkey wurde nicht entfernt. Versuche es noch einmal." });
    } finally { setBusy(false); }
  }

  if (!allowed || !supported) return { rows: [], note: null, confirm: null };
  const confirm = removing
    ? <Confirm title="Passkey entfernen?" back="Mehr" action="Entfernen" busyAction="Wird entfernt …" busy={busy} onConfirm={() => void remove(removing)} onCancel={() => { focusNext.current = `passkey-remove-${removing.id}`; setRemoving(null); }}>
      <div className="ow-qpanel ow-stack ow-stack--tight"><p><strong>{removing.name || "Passkey"}</strong></p><p>Du meldest dich dann wieder mit deinem Passwort an. Lösche ihn auch in den Einstellungen deines Geräts.</p></div>
    </Confirm>
    : null;
  const addRow = (placeholder: boolean) => <button key={placeholder ? "passkey-placeholder" : ADD_ID} id={placeholder ? undefined : ADD_ID} type="button"
    className="ow-prog-row" aria-busy={busy || undefined} disabled={placeholder} aria-hidden={placeholder || undefined} data-placeholder={placeholder || undefined} onClick={() => void add()}>
    <span className="ow-prog-icon">{spinning ? <span className="ow-spinner" aria-hidden="true" /> : <Plus size={22} aria-hidden="true" />}</span>
    <span className="ow-prog-main"><span className="ow-prog-text"><strong>Passkey hinzufügen</strong><small>{SUB}</small></span></span>
  </button>;
  // Until the list answers, the add row's twin holds its place, so Konto does not jump when it arrives.
  if (keys === null) return { rows: [addRow(true)], note, confirm };
  const rows = keys.map(key => <div key={key.id} className="ow-rowfold" data-added={known?.has(key.id) ? undefined : ""} data-closing={closing === key.id || undefined}>
    <div className="ow-prog-row" data-ends="button">
      <span className="ow-prog-icon"><KeyRound size={22} aria-hidden="true" /></span>
      <span className="ow-prog-main"><span className="ow-prog-text"><strong>{key.name || "Passkey"}</strong>{key.createdAt && <small>Hinzugefügt am {germanDate(key.createdAt, "long", { timeZone: zone })}</small>}</span></span>
      <button type="button" id={`passkey-remove-${key.id}`} className="ow-btn ow-btn--secondary ow-btn--sm" disabled={busy} onClick={() => { setNote(null); setRemoving(key); }}>Entfernen</button>
    </div>
  </div>);
  return { rows: [...rows, addRow(false)], note, confirm };
}
