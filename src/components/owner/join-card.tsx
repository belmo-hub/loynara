"use client";

import { ChevronRight, Link2, Printer } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { MeResponse } from "@/components/client-api";
import { counterSignHtml, SIGN_FONT } from "@/lib/counter-sign";
import { OwnerIcon } from "./owner-ui";
import { CopyLabel, useCopy } from "@/components/copy-text";

/** The public programme address customers join at, not a private card link; "" while it is not configured. */
export const joinUrlOf = (me: MeResponse) => me.publicBaseUrl ? new URL(`/join/${encodeURIComponent(me.programSlug)}`, me.publicBaseUrl).toString() : "";

/**
 * ENG-343: opens the printable counter sign (Tresenschild) in a new tab with a „Drucken“ button, so a phone can print or
 * share it; where no tab may open, downloads it as before. Throws a German message on failure.
 */
export async function openCounterSign(me: MeResponse): Promise<"opened" | "downloaded"> {
  const joinUrl = joinUrlOf(me);
  if (!joinUrl) throw new Error("Die öffentliche Adresse ist noch nicht konfiguriert.");
  // Before the first await: a phone opens a tab only straight from the tap. Empty until the sign is ready.
  const tab = window.open("", "_blank");
  try {
    const response = await fetch(`/api/qr?value=${encodeURIComponent(joinUrl)}`, { credentials: "same-origin" });
    if (!response.ok) throw new Error("Der QR-Code konnte nicht geladen werden.");
    const sign = { businessName: me.businessName, locationName: me.locationName, joinUrl, qrSvg: await response.text(), programType: me.programType, rewardTitle: me.rewardTitle, rewardCost: me.rewardCost };
    if (tab) {
      const html = counterSignHtml({ ...sign, fontSrc: SIGN_FONT });
      tab.document.open(); tab.document.write(html); tab.document.close();
      return "opened";
    }
    // The file prints in Manrope when the font loads; without it, in Arial.
    const fontSrc = await fetch(SIGN_FONT).then(r => r.ok ? r.blob() : null).then(blob => blob && new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]*;/, "data:font/woff2;")); reader.onerror = reject; reader.readAsDataURL(blob);
    })).catch(() => undefined) ?? undefined;
    const url = URL.createObjectURL(new Blob([counterSignHtml({ ...sign, fontSrc })], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "anmeldeschild.html"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return "downloaded";
  } catch (error) { tab?.close(); throw error; }
}

/** What the Tresenschild row says after a tap (ENG-343): the tab may open behind this one, so the row confirms it. */
export const SIGN_NOTE = { idle: "Mit QR-Code zum Ausdrucken", busy: "Wird erstellt …", opened: "Schild geöffnet", downloaded: "Schild heruntergeladen" } as const;

/** „Kunden einladen“ on Kunden (ENG-122a, R3) as two rows: copy the sign-up link, download the Tresenschild. */
export function InviteRows({ me }: { me: MeResponse }) {
  const { copied, copy } = useCopy();
  const [error, setError] = useState("");
  const [sign, setSign] = useState<"idle" | "busy" | "opened" | "downloaded">("idle");
  const joinUrl = joinUrlOf(me);
  const row = (icon: ReactNode, title: string, sub: string | undefined, onClick: () => void) => <li><button type="button" className="ow-prog-row" onClick={() => { setError(""); onClick(); }}>
    <span className="ow-prog-icon">{icon}</span>
    <span className="ow-prog-main"><span className="ow-prog-text"><strong>{title}</strong>{sub && <small>{sub}</small>}</span></span>
    <ChevronRight className="ow-prog-arrow" size={20} aria-hidden="true" />
  </button></li>;
  return (
    <div>
      <h2>Kunden einladen</h2>
      {!joinUrl ? <p className="ow-prog-note">Die öffentliche Adresse ist noch nicht konfiguriert. Der Anmeldelink ist deshalb nicht verfügbar.</p> : <ul>
        {row(<Link2 size={20} aria-hidden="true" />, copied ? "Kopiert" : "Anmeldelink kopieren", undefined,
          () => void copy(joinUrl).then(ok => { if (!ok) setError("Kopieren nicht möglich. Markiere den Link und kopiere ihn manuell."); }))}
        {row(<Printer size={20} aria-hidden="true" />, "Tresenschild laden", SIGN_NOTE[sign],
          () => { setSign("busy"); openCounterSign(me).then(setSign, cause => { setSign("idle"); setError(cause instanceof Error ? cause.message : "Das Anmeldeschild konnte nicht erstellt werden."); }); })}
      </ul>}
      <div role="status" aria-live="polite" className="ow-sr">{copied ? "Link kopiert." : sign === "idle" ? null : SIGN_NOTE[sign]}</div>
      {error && <p className="ow-error ow-qerror ow-prog-note" role="alert"><OwnerIcon name="alert" size={20} />{error}</p>}
    </div>
  );
}

/** Invite link and printable counter sign; the join URL is the public programme address, not a private card link. */
export function JoinCard({ me, exportUrl }: { me: MeResponse; exportUrl?: string }) {
  const { copied, copy: copyLink } = useCopy();
  const [error, setError] = useState("");
  const joinUrl = joinUrlOf(me);

  async function copy() {
    setError("");
    if (!await copyLink(joinUrl)) setError("Kopieren nicht möglich. Markiere den Link und kopiere ihn manuell.");
  }
  async function downloadSign() {
    setError("");
    try { await openCounterSign(me); } catch (cause) { setError(cause instanceof Error ? cause.message : "Das Anmeldeschild konnte nicht erstellt werden."); }
  }

  if (!joinUrl) return <div className="ow-card"><h2>Kunden einladen</h2><p className="ow-muted ow-mt-2">Die öffentliche Adresse ist noch nicht konfiguriert. Der Anmeldelink ist deshalb nicht verfügbar.</p></div>;
  return (
    <section className="ow-card ow-card--flat ow-stack" aria-labelledby="ow-join-title">
      <div><h2 id="ow-join-title">Kunden einladen</h2><p className="ow-muted ow-mt-1" style={{ fontSize: "var(--text-14)" }}>Dieser Link führt zur Anmeldung für {me.locationName}.</p></div>
      <div className="ow-field"><label htmlFor="ow-join-url" className="ow-sr">Anmeldelink</label><input id="ow-join-url" className="ow-input" readOnly value={joinUrl} onFocus={event => event.currentTarget.select()} /></div>
      <div className="ow-row">
        <button type="button" className="ow-btn ow-btn--secondary" onClick={() => void copy()}><CopyLabel copied={copied} label="Link kopieren" /></button>
        <button type="button" className="ow-btn ow-btn--secondary" onClick={() => void downloadSign()}><OwnerIcon name="phone" size={20} />Tresenschild laden</button>
      </div>
      <div role="status" aria-live="polite" className="ow-sr">{copied && "Link kopiert."}</div>
      {error && <p className="ow-error ow-qerror" role="alert"><OwnerIcon name="alert" size={20} />{error}</p>}
      {exportUrl && <div className="ow-hint">
        <p>Lade deine Karten und Buchungen für Excel herunter. Kontaktdaten deiner Kundinnen und Kunden sind nicht enthalten.</p>
        <p><a className="ow-link ow-link--block" href={`${exportUrl}?format=karten`} download>Karten für Excel</a>: Eine Zeile pro Karte mit aktuellem Stand.</p>
        <p><a className="ow-link ow-link--block" href={`${exportUrl}?format=buchungen`} download>Buchungen für Excel</a>: Jeder Stempel, jede Einlösung und jede Korrektur mit Datum und Standort.</p>
        <p><a className="ow-link ow-link--block" href={exportUrl} download>Vollständiger Export (JSON)</a></p>
      </div>}
    </section>
  );
}
