"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { postJson } from "@/components/client-api";
import { BrandMark } from "@/components/loyalty-ui";

export default function VerifyEmailPage() {
  const [state, setState] = useState<"ready" | "checking" | "verified" | "invalid">("ready");
  const token = useRef("");

  useEffect(() => {
    token.current = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    window.history.replaceState(null, "", window.location.pathname);
    if (!token.current) setState("invalid");
  }, []);

  async function confirm() {
    if (!token.current) { setState("invalid"); return; }
    setState("checking");
    try { await postJson<{ verified: true }>("/api/contact/verify", { token: token.current }); setState("verified"); }
    catch { setState("invalid"); }
    finally { token.current = ""; }
  }

  return <main className="card-state-page"><div><BrandMark /><h1>{state === "checking" ? "E-Mail wird bestätigt …" : state === "verified" ? "E-Mail bestätigt." : state === "invalid" ? "Bestätigungslink ungültig." : "E-Mail-Adresse bestätigen"}</h1><p>{state === "checking" ? "Bitte warte, während wir den einmaligen Link prüfen." : state === "verified" ? "Deine E-Mail-Adresse ist jetzt als Wiederherstellungsmethode bestätigt. Marketing-E-Mails bleiben aus, bis du sie auf deiner Karte ausdrücklich aktivierst." : state === "invalid" ? "Der Link ist abgelaufen, wurde bereits genutzt oder gehört nicht mehr zur aktuellen Adresse. Öffne deine Karte und fordere bei Bedarf einen neuen Link an." : "Bestätige diese Adresse nur, wenn du sie selbst als Wiederherstellungsmethode für deine Loynara-Karte angefordert hast."}</p>{state === "ready" && <button className="button" onClick={() => void confirm()}>E-Mail-Adresse bestätigen</button>}<Link href="/">Zur Startseite</Link></div></main>;
}
