"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiJson, type CardResponse } from "./client-api";
import { BrandMark } from "./loyalty-ui";

type Preview = { merchantName: string; locationName: string; programName: string; programSlug: string; brandColor: string; mode: "disabled" | "automatic_fixed" | "staff_confirmed"; hasMembership: boolean; cardPath?: string };
type Result = { state: "awarded" | "already_processed" | "cooldown" | "pending_staff" | "needs_enrollment" | "disabled"; balance?: number };

export function TapClient({ refId }: { refId: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [card, setCard] = useState<CardResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const path = `/api/tap/${encodeURIComponent(refId)}${window.location.search}`;
    void apiJson<Preview>(path).then(async info => {
      if (!active) return;
      setPreview(info);
      if (!info.hasMembership || info.mode === "disabled") return;
      const processed = await apiJson<Result>(path, { method: "POST" });
      if (active) setResult(processed);
      if (info.cardPath) void apiJson<CardResponse>(`/api${info.cardPath}`).then(value => { if (active) setCard(value); }).catch(() => {});
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Der NFC-Link konnte nicht geprüft werden."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refId]);

  function join() {
    // Only a relative tap URL can be restored after normal enrollment.
    if (preview) sessionStorage.setItem("loynara_tap_return", `${window.location.pathname}${window.location.search}`);
  }

  const title = loading ? "NFC-Berührung wird geprüft" : error ? "NFC-Link nicht verfügbar" : !preview?.hasMembership || result?.state === "needs_enrollment" ? "Deine Karte erstellen" : result?.state === "awarded" ? "Stempel erhalten" : result?.state === "already_processed" ? "Stempel bereits gebucht" : result?.state === "pending_staff" ? "Bestätigung an der Kasse offen" : result?.state === "cooldown" ? "Karte erkannt" : preview?.mode === "disabled" ? "NFC derzeit nicht aktiv" : "Karte erkannt";
  const detail = error || (loading ? "Einen Moment bitte." : result?.state === "awarded" ? "Ein Stempel wurde bestätigt und deinem Konto gutgeschrieben." : result?.state === "already_processed" ? "Dieser NFC-Vorgang wurde bereits verarbeitet. Es wurde nichts doppelt gebucht." : result?.state === "pending_staff" ? "Zeige dem Team deine Karte. Dein Kontostand ändert sich erst nach der Bestätigung." : result?.state === "cooldown" ? "Deine Karte wurde erkannt. Für diesen Besuch kann noch kein neuer Stempel gebucht werden." : preview?.mode === "disabled" ? "Bitte nutze deine Karte und den QR-Code an der Kasse." : "Nach der Anmeldung wird dieser NFC-Vorgang erneut geprüft. Bewahre deinen Kartenlink auf.");
  const nextReward = card && typeof result?.balance === "number" ? [...card.rewards].sort((a, b) => a.cost - b.cost).find(reward => reward.cost > result.balance!) : undefined;
  return <main className="card-state-page" style={{ minHeight: "100vh", background: "#f7f4ec", padding: "24px" }}><div style={{ maxWidth: 480, margin: "auto", padding: "28px", borderRadius: 20, background: "white", color: "#17372c" }}><BrandMark />
    {preview && <p style={{ borderLeft: `4px solid ${preview.brandColor || "#214739"}`, paddingLeft: 12 }}><strong>{preview.merchantName}</strong><br />{preview.locationName} · {preview.programName}</p>}
    <h1>{title}</h1><p role={error ? "alert" : "status"}>{detail}</p>
    {typeof result?.balance === "number" && <p style={{ fontSize: "1.2rem", fontWeight: 700 }}>Aktueller Stand: {result.balance} Stempel</p>}
    {nextReward && typeof result?.balance === "number" && <p>Nächste Prämie: {nextReward.title} ab {nextReward.cost} Stempeln. {nextReward.cost - result.balance} fehlen noch.</p>}
    {!nextReward && card?.rewards.length && typeof result?.balance === "number" && <p>Eine Prämie ist verfügbar. Sieh deine Karte für alle Möglichkeiten an.</p>}
    {preview && (!preview.hasMembership || result?.state === "needs_enrollment") && <Link className="button button--accent" href={`/join/${encodeURIComponent(preview.programSlug)}`} onClick={join}>Karte erstellen</Link>}
    {preview?.cardPath && <p><Link className="button button--outline" href={preview.cardPath}>Karte und Prämien ansehen</Link></p>}
  </div></main>;
}
