"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/loyalty-ui";
import { postJson } from "@/components/client-api";
import { recoveryConfirmationFeedback } from "@/components/recovery-confirm-feedback";

type Option = { membershipId: string; merchantName: string; programmeName: string };
export default function RecoverConfirmPage() {
  const token = useRef("");
  const captured = useRef(false);
  const generation = useRef(0);
  const [cards, setCards] = useState<Option[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Scrubbing must survive strict effects and allow a later email link in the same tab.
  useEffect(() => {
    function capture() {
      const next = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
      if (!next && captured.current) return;
      captured.current = true;
      token.current = next;
      generation.current += 1;
      window.history.replaceState(null, "", window.location.pathname);
      setCards(null); setBusy(false); setError("");
    }
    capture();
    window.addEventListener("hashchange", capture);
    return () => window.removeEventListener("hashchange", capture);
  }, []);
  async function showCards() {
    const submitted = generation.current, proof = token.current;
    setBusy(true); setError("");
    try {
      const result = await postJson<{ cards: Option[] }>("/api/recover/confirm", { action: "list", token: proof });
      if (generation.current === submitted) setCards(result.cards);
    } catch (cause) { if (generation.current === submitted) setError(recoveryConfirmationFeedback(cause, "list")); }
    finally { if (generation.current === submitted) setBusy(false); }
  }
  async function recover(membershipId: string) {
    const submitted = generation.current, proof = token.current;
    setBusy(true); setError("");
    try {
      const result = await postJson<{ cardToken: string }>("/api/recover/confirm", { action: "rotate", token: proof, membershipId });
      if (generation.current !== submitted) return;
      token.current = "";
      // Keep the successful rotated private link even if later browser binding fails.
      // CardClient requires explicit authentication/switching; no second cookie-setting race here.
      window.location.replace(`/card/${encodeURIComponent(result.cardToken)}`);
    } catch (cause) { if (generation.current === submitted) { setError(recoveryConfirmationFeedback(cause, "rotate")); setBusy(false); } }
  }
  return <main className="card-state-page"><div><BrandMark /><h1>Karte wiederherstellen</h1>
    <p>Erst deine ausdrückliche Bestätigung erstellt einen neuen privaten Kartenlink. Danach funktioniert der bisherige Link nicht mehr.</p>
    {cards === null ? <button className="button" disabled={busy} onClick={() => void showCards()}>Meine Karten anzeigen</button>
      : <div className="recovery-options">{cards.map(card => <div key={card.membershipId}><strong>{card.merchantName}</strong><span>{card.programmeName}</span><button className="button" disabled={busy} onClick={() => void recover(card.membershipId)}>Diese Karte wiederherstellen</button></div>)}</div>}
    {error && <p role="alert">{error}</p>}<Link href="/recover">Neuen Link anfordern</Link>
  </div></main>;
}
