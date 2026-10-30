"use client";

import { ArrowRight, Link2, Printer } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { MeResponse } from "@/components/client-api";
import { counterSignHtml } from "@/lib/counter-sign";
import { OwnerIcon } from "./owner-ui";
import { CopyLabel, useCopy } from "@/components/copy-text";

/** The public programme address customers join at, not a private card link; "" while it is not configured. */
export const joinUrlOf = (me: MeResponse) => me.publicBaseUrl ? new URL(`/join/${encodeURIComponent(me.programSlug)}`, me.publicBaseUrl).toString() : "";

/** Downloads the printable counter sign (Tresenschild) for this programme; throws a German message on failure. */
export async function downloadCounterSign(me: MeResponse) {
  const joinUrl = joinUrlOf(me);
  if (!joinUrl) throw new Error("Die öffentliche Adresse ist noch nicht konfiguriert.");
  const response = await fetch(`/api/qr?value=${encodeURIComponent(joinUrl)}`, { credentials: "same-origin" });
  if (!response.ok) throw new Error("Der QR-Code konnte nicht geladen werden.");
  const html = counterSignHtml({ businessName: me.businessName, locationName: me.locationName, joinUrl, qrSvg: await response.text(), programType: me.programType, rewardTitle: me.rewardTitle, rewardCost: me.rewardCost });
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = "anmeldeschild.html"; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** „Kunden einladen“ on Kunden (ENG-122a, R3) as two rows: copy the sign-up link, download the Tresenschild. */
export function InviteRows({ me }: { me: MeResponse }) {
  const { copied, copy } = useCopy();
  const [error, setError] = useState("");
  const joinUrl = joinUrlOf(me);
  const row = (icon: ReactNode, title: string, sub: string, onClick: () => void) => <li><button type="button" className="ow-prog-row" onClick={() => { setError(""); onClick(); }}>
    <span className="ow-prog-icon">{icon}</span>
    <span className="ow-prog-main"><span className="ow-prog-text"><strong>{title}</strong><small>{sub}</small></span></span>
    <ArrowRight className="ow-prog-arrow" size={22} aria-hidden="true" />
  </button></li>;
  return (
    <div>
      <h2>Kunden einladen</h2>
      {!joinUrl ? <p className="ow-prog-note">Die öffentliche Adresse ist noch nicht konfiguriert. Der Anmeldelink ist deshalb nicht verfügbar.</p> : <ul>
        {row(<Link2 size={22} aria-hidden="true" />, copied ? "Kopiert" : "Anmeldelink kopieren", joinUrl.replace(/^https?:\/\//, ""),
          () => void copy(joinUrl).then(ok => { if (!ok) setError("Kopieren nicht möglich. Markiere den Link und kopiere ihn manuell."); }))}
        {row(<Printer size={22} aria-hidden="true" />, "Tresenschild laden", "Mit QR-Code zum Ausdrucken",
          () => void downloadCounterSign(me).catch(cause => setError(cause instanceof Error ? cause.message : "Das Anmeldeschild konnte nicht erstellt werden.")))}
      </ul>}
      <div role="status" aria-live="polite" className="ow-sr">{copied && "Link kopiert."}</div>
      {error && <p className="ow-error ow-prog-note" role="alert">{error}</p>}
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
    try { await downloadCounterSign(me); } catch (cause) { setError(cause instanceof Error ? cause.message : "Das Anmeldeschild konnte nicht erstellt werden."); }
  }

  if (!joinUrl) return <div className="ow-card"><h2>Kunden einladen</h2><p className="ow-muted ow-mt-2">Die öffentliche Adresse ist noch nicht konfiguriert. Der Anmeldelink ist deshalb nicht verfügbar.</p></div>;
  return (
    <section className="ow-card ow-card--flat ow-stack" aria-labelledby="ow-join-title">
      <div><h2 id="ow-join-title">Kunden einladen</h2><p className="ow-muted ow-mt-1" style={{ fontSize: "var(--text-14)" }}>Dieser Link führt zur Anmeldung für {me.locationName}.</p></div>
      <div className="ow-field"><label htmlFor="ow-join-url" className="ow-sr">Anmeldelink</label><input id="ow-join-url" className="ow-input" readOnly value={joinUrl} onFocus={event => event.currentTarget.select()} /></div>
      <div className="ow-row">
        <button type="button" className="ow-btn ow-btn--secondary" onClick={() => void copy()}><CopyLabel copied={copied} label="Link kopieren" /></button>
        <button type="button" className="ow-btn ow-btn--secondary" onClick={() => void downloadSign()}><OwnerIcon name="phone" size={18} />Tresenschild laden</button>
      </div>
      <div role="status" aria-live="polite" className="ow-sr">{copied && "Link kopiert."}</div>
      {error && <p className="ow-error" role="alert">{error}</p>}
      {exportUrl && <div className="ow-hint">
        <p>Lade deine Karten und Buchungen für Excel herunter. Kontaktdaten deiner Kundinnen und Kunden sind nicht enthalten.</p>
        <p><a className="ow-link ow-link--block" href={`${exportUrl}?format=karten`} download>Karten für Excel</a>: Eine Zeile pro Karte mit aktuellem Stand.</p>
        <p><a className="ow-link ow-link--block" href={`${exportUrl}?format=buchungen`} download>Buchungen für Excel</a>: Jeder Stempel, jede Einlösung und jede Korrektur mit Datum und Standort.</p>
        <p><a className="ow-link ow-link--block" href={exportUrl} download>Vollständiger Export (JSON)</a></p>
      </div>}
    </section>
  );
}
