"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { postJson } from "@/components/client-api";
import { BrandMark } from "@/components/loyalty-ui";

export default function VerifyEmailPage() {
  const [state, setState] = useState<"checking" | "verified" | "invalid">("checking");
  const verification = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    let active = true;
    if (!verification.current) {
      const fragment = window.location.hash.slice(1);
      const token = new URLSearchParams(fragment).get("token");
      window.history.replaceState(null, "", window.location.pathname);
      verification.current = token
        ? postJson<{ verified: true }>("/api/contact/verify", { token }).then(() => true, () => false)
        : Promise.resolve(false);
    }
    void verification.current.then(verified => { if (active) setState(verified ? "verified" : "invalid"); });
    return () => { active = false; };
  }, []);

  return <main className="card-state-page"><div><BrandMark /><h1>{state === "checking" ? "E-Mail wird bestätigt …" : state === "verified" ? "E-Mail bestätigt." : "Bestätigungslink ungültig."}</h1><p>{state === "checking" ? "Bitte warte, während wir den einmaligen Link prüfen." : state === "verified" ? "Deine synthetische Testadresse ist jetzt verifiziert. Marketing-E-Mails bleiben aus, bis du sie auf deiner Karte ausdrücklich aktivierst." : "Der Link ist abgelaufen, wurde bereits genutzt oder gehört nicht mehr zur aktuellen Adresse. Öffne deine Karte und fordere bei Bedarf einen neuen Link an."}</p><Link href="/">Zur Startseite</Link></div></main>;
}
