"use client";

import { useEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { authClient } from "@/lib/auth-client";
import { clearBoardCache } from "@/lib/board-cache";

/** `children` lays out the label (the owner's „Mehr“ page draws sign-out as one of its rows). */
export function LogoutButton({ className, onSignedOut, children }: { className?: string; onSignedOut?: () => void; children?: (label: string) => ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    // A restored document can retain React state even though its session was revoked.
    const recheck = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("pageshow", recheck);
    return () => window.removeEventListener("pageshow", recheck);
  }, []);

  async function signOut() {
    setBusy(true); setError(false);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error("Sign-out failed");
      clearBoardCache(); // the Übersicht's last numbers on this device belong to the person signing out
      // Clear merchant state and its unload guard before leaving the document.
      if (onSignedOut) flushSync(onSignedOut);
      window.location.replace("/login");
    } catch {
      setError(true); setBusy(false);
    }
  }

  return <div>
    <button type="button" className={className} style={{ minHeight: 44 }} disabled={busy} onClick={() => void signOut()}>{(children ?? (label => label))(busy ? "Abmeldung läuft …" : "Abmelden")}</button>
    {error && <p role="alert">Abmelden fehlgeschlagen. Bitte versuche es erneut.</p>}
  </div>;
}
