"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CircleAlert, KeyRound } from "lucide-react";
import { CustomerState } from "@/components/customer/customer-state";
import styles from "@/components/customer/states.module.css";
import { Button, buttonClassName } from "@/components/ui/button";
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
  // G-10: a link opened without its token can only fail, so it gets the invalid state instead of the button.
  const [missing, setMissing] = useState(false);
  // Scrubbing must survive strict effects and allow a later email link in the same tab.
  useEffect(() => {
    function capture() {
      const next = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
      if (!next && captured.current) return;
      captured.current = true;
      token.current = next;
      generation.current += 1;
      window.history.replaceState(null, "", window.location.pathname);
      setCards(null); setBusy(false); setError(""); setMissing(!next);
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
  if (missing) return <CustomerState tone="error" icon={<CircleAlert size={24} />} title="Link unvollständig" message="Bitte fordere einen neuen Link an und öffne ihn direkt aus der E-Mail.">
    <Link className={buttonClassName({ variant: "secondary", block: true })} href="/recover">Neuen Link anfordern</Link>
  </CustomerState>;
  return <CustomerState icon={<KeyRound size={22} />} title="Karte wiederherstellen" message="Erst deine ausdrückliche Bestätigung erstellt einen neuen privaten Kartenlink. Danach funktionieren der bisherige Link und der bisherige QR-Code nicht mehr. Eine im Wallet gespeicherte Karte fügst du über den neuen Link erneut hinzu.">
    {cards === null ? <Button block loading={busy} onClick={() => void showCards()}>Meine Karten anzeigen</Button>
      : <div className={`recovery-options ${styles.options}`}>{cards.map(card => <div key={card.membershipId}><div className={styles.optionText}><strong>{card.merchantName}</strong><span>{card.programmeName}</span></div><Button size="sm" disabled={busy} onClick={() => void recover(card.membershipId)}>Diese Karte wiederherstellen</Button></div>)}</div>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <p className={styles.link}><Link href="/recover">Neuen Link anfordern</Link></p>
  </CustomerState>;
}
