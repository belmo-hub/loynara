"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { authClient } from "@/lib/auth-client";

export function LogoutButton({ className, onSignedOut }: { className?: string; onSignedOut?: () => void }) {
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
      // Clear merchant state and its unload guard before leaving the document.
      if (onSignedOut) flushSync(onSignedOut);
      window.location.replace("/login");
    } catch {
      setError(true); setBusy(false);
    }
  }

  return <div>
    <button type="button" className={className} style={{ minHeight: 44 }} disabled={busy} onClick={() => void signOut()}>{busy ? "Abmeldung läuft …" : "Abmelden"}</button>
    {error && <p role="alert">Abmelden fehlgeschlagen. Bitte versuche es erneut.</p>}
  </div>;
}
