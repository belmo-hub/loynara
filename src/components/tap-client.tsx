"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiJson, ClientApiError, type CardResponse } from "./client-api";
import { BrandMark } from "./loyalty-ui";

type Preview = { merchantName: string; locationName: string; programName: string; programSlug: string; brandColor: string; mode: "disabled" | "automatic_fixed" | "staff_confirmed"; hasMembership: boolean; cardPath?: string };
export type TapState = "awarded" | "already_processed" | "confirmed" | "cooldown" | "pending_staff" | "expired" | "cancelled" | "needs_enrollment" | "disabled";
type Result = { state: TapState; balance?: number; expiresAt?: string; cardLocator?: string; requestId?: string; statusRef?: string };
/** States in which the server also returns the card number, so the cashier can match the right request. */
const STATES_WITH_CARD_NUMBER: ReadonlyArray<TapState> = ["pending_staff", "confirmed", "awarded", "already_processed"];

const POLL_MS = 4000;
export const TAP_RETURN_KEY = "loynara_tap_return";
const TAP_URL = /^\/tap\/[A-Za-z0-9_-]{24}\?e=[a-fA-F0-9]{32}&c=[a-fA-F0-9]{16}$/;

/** What the customer is told for each state of the same tap. Reloading never produces an error for a request that exists. */
export function tapCopy(state: TapState | "loading" | "error", error?: ClientApiError | Error): { title: string; detail: string } {
  switch (state) {
    case "loading": return { title: "NFC-Berührung wird geprüft", detail: "Einen Moment bitte." };
    case "needs_enrollment": return { title: "Deine Karte erstellen", detail: "Mit einer kostenlosen Karte im Browser sammelst du Stempel. Du brauchst keine App." };
    case "pending_staff": return { title: "Warte auf das Team", detail: "Das Team an der Kasse bestätigt deinen Stempel. Du musst nichts weiter tun." };
    case "confirmed": return { title: "Stempel erhalten", detail: "Das Team hat deinen Stempel bestätigt. Er ist auf deiner Karte gebucht." };
    case "awarded": return { title: "Stempel erhalten", detail: "Ein Stempel wurde bestätigt und auf deiner Karte gebucht." };
    case "already_processed": return { title: "Schon erledigt", detail: "Diese Berührung wurde bereits verarbeitet. Es wurde nichts doppelt gebucht." };
    case "cooldown": return { title: "Gerade erst gestempelt", detail: "Auf deiner Karte wurde gerade erst ein Stempel gebucht. Beim nächsten Besuch kannst du das Schild wieder berühren." };
    case "expired": return { title: "Anfrage abgelaufen", detail: "Das Team hat diese Anfrage nicht rechtzeitig bestätigt. Berühre das Schild noch einmal, um es erneut zu versuchen." };
    case "cancelled": return { title: "Nicht bestätigt", detail: "Das Team hat diese Anfrage nicht bestätigt. Frage bitte an der Kasse nach." };
    case "disabled": return { title: "NFC ist hier aus", detail: "Für dieses Programm ist die NFC-Berührung gerade ausgeschaltet. Zeige stattdessen deinen Kartencode an der Kasse." };
    case "error":
      if (error instanceof ClientApiError && error.status === 404) return { title: "Dieses Schild ist gerade nicht aktiv", detail: "Bitte nutze den QR-Code an der Kasse oder frage das Team." };
      if (error instanceof ClientApiError && error.status === 429) return { title: "Zu viele Versuche", detail: "Bitte warte einen Moment und berühre das Schild erneut." };
      if (error instanceof ClientApiError && error.status === 0) return { title: "Keine Verbindung", detail: error.message };
      return { title: "Berührung nicht bestätigt", detail: "Die Berührung konnte nicht geprüft werden. Bitte berühre das Schild erneut." };
  }
}

export function TapClient({ refId }: { refId: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [card, setCard] = useState<CardResponse | null>(null);
  const [error, setError] = useState<Error | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pollingController: AbortController | undefined;
    const path = `/api/tap/${encodeURIComponent(refId)}${window.location.search}`;
    function report(processed: Result, info: Preview, boundRef = refId) {
      if (!active) return;
      setResult(processed);
      if (processed.state === "pending_staff") {
        if (!processed.requestId) throw new Error("Die wartende Anfrage konnte nicht geladen werden.");
        // Waiting is a card-authorized read, so it never spends the shared allowance for a fresh physical tap.
        const requestId = processed.requestId;
        timer = setTimeout(() => void poll(info, requestId, processed.statusRef ?? boundRef), POLL_MS);
      } else if (info.cardPath) {
        void apiJson<CardResponse>(`/api${info.cardPath}`).then(value => { if (active) setCard(value); }).catch(() => {});
      }
    }
    async function poll(info: Preview, requestId: string, boundRef: string) {
      if (!active) return;
      const controller = new AbortController();
      pollingController = controller;
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const processed = await apiJson<Result>(`/api/tap/${encodeURIComponent(boundRef)}/status/${encodeURIComponent(requestId)}`, { signal: controller.signal });
        report(processed, info, boundRef);
      } catch (cause) {
        if (!active) return;
        if (cause instanceof ClientApiError && (cause.status === 0 || cause.status === 429 || cause.status >= 500)) {
          // Keep waiting across temporary failures; the server will still decide confirmation, cancellation and expiry.
          const delay = Math.min(15 * 60_000, Math.max(POLL_MS, cause.retryAfterMs ?? POLL_MS));
          timer = setTimeout(() => void poll(info, requestId, boundRef), delay);
        } else setError(cause instanceof Error ? cause : new Error("Berührung nicht bestätigt"));
      } finally { clearTimeout(timeout); }
    }
    async function process(info: Preview) {
      // Only the initial submission verifies the chip and creates a request. Retrying that submission remains idempotent.
      report(await apiJson<Result>(path, { method: "POST" }), info);
    }
    void apiJson<Preview>(path).then(async info => {
      if (!active) return;
      setPreview(info);
      if (!info.hasMembership) { setResult({ state: "needs_enrollment" }); return; }
      if (info.mode === "disabled") { setResult({ state: "disabled" }); return; }
      await process(info);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause : new Error("Berührung nicht bestätigt")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; if (timer) clearTimeout(timer); pollingController?.abort(); };
  }, [refId]);

  const state: TapState | "loading" | "error" = loading ? "loading" : error ? "error" : (result?.state ?? "loading");
  // A card created or opened later in this tab continues this tap (the join page and the card page read the stored path).
  useEffect(() => {
    const here = `${window.location.pathname}${window.location.search}`;
    if (state === "needs_enrollment" && TAP_URL.test(here)) sessionStorage.setItem(TAP_RETURN_KEY, here);
  }, [state]);

  const { title, detail } = tapCopy(state, error);
  const nextReward = card && typeof result?.balance === "number" ? [...card.rewards].sort((a, b) => a.cost - b.cost).find(reward => reward.cost > result.balance!) : undefined;
  const waiting = state === "pending_staff";
  return <main className="card-state-page" style={{ minHeight: "100vh", background: "#f7f4ec", padding: "24px" }}><div style={{ maxWidth: 480, margin: "auto", padding: "28px", borderRadius: 20, background: "white", color: "#17372c" }}><BrandMark />
    {preview && <p style={{ borderLeft: `4px solid ${preview.brandColor || "#214739"}`, paddingLeft: 12 }}><strong>{preview.merchantName}</strong><br />{preview.locationName} · {preview.programName}</p>}
    <h1>{title}</h1><p role={state === "error" ? "alert" : "status"} aria-live="polite">{detail}</p>
    {result?.cardLocator && STATES_WITH_CARD_NUMBER.includes(state as TapState) && <p style={{ fontSize: "1rem", fontWeight: 700 }}>Deine Kartennummer (das Team sieht sie an der Kasse): <span translate="no" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: ".06em", overflowWrap: "anywhere" }}>{result.cardLocator}</span></p>}
    {waiting && <p className="ow-muted" style={{ fontSize: 14 }}>Die Seite aktualisiert sich automatisch, sobald das Team bestätigt hat.</p>}
    {typeof result?.balance === "number" && state !== "needs_enrollment" && <p style={{ fontSize: "1.2rem", fontWeight: 700 }}>Aktueller Stand: {result.balance} Stempel</p>}
    {nextReward && typeof result?.balance === "number" && (state === "confirmed" || state === "awarded" || state === "already_processed") && <p>Nächste Prämie: {nextReward.title} ab {nextReward.cost} Stempeln. {nextReward.cost - result.balance} fehlen noch.</p>}
    {preview && state === "needs_enrollment" && <>
      <Link className="button button--accent" href={`/join/${encodeURIComponent(preview.programSlug)}`}>Karte erstellen</Link>
      <p style={{ fontSize: 14, marginTop: 16 }}><strong>Du hast schon eine Karte?</strong> Öffne deinen gespeicherten Kartenlink in diesem Browser-Tab. Danach geht es hier automatisch weiter.</p>
    </>}
    {preview?.cardPath && state !== "needs_enrollment" && <p><Link className="button button--outline" href={preview.cardPath}>Karte und Prämien ansehen</Link></p>}
    {state === "error" && <p style={{ fontSize: 14 }}>Du kannst jederzeit stattdessen den QR-Code an der Kasse zeigen.</p>}
  </div></main>;
}

