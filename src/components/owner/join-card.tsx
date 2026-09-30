"use client";

import { useState } from "react";
import type { MeResponse } from "@/components/client-api";
import { counterSignHtml } from "@/lib/counter-sign";
import { OwnerIcon } from "./owner-ui";

/** Invite link and printable counter sign; the join URL is the public programme address, not a private card link. */
export function JoinCard({ me, exportUrl }: { me: MeResponse; exportUrl?: string }) {
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const joinUrl = me.publicBaseUrl ? new URL(`/join/${encodeURIComponent(me.programSlug)}`, me.publicBaseUrl).toString() : "";

  async function copy() {
    setError("");
    try { await navigator.clipboard.writeText(joinUrl); setCopied("Link kopiert."); } catch { setCopied(""); setError("Kopieren nicht möglich. Markiere den Link und kopiere ihn manuell."); }
  }
  async function downloadSign() {
    setError("");
    try {
      const response = await fetch(`/api/qr?value=${encodeURIComponent(joinUrl)}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error("Der QR-Code konnte nicht geladen werden.");
      const html = counterSignHtml({ businessName: me.businessName, locationName: me.locationName, joinUrl, qrSvg: await response.text(), programType: me.programType, rewardTitle: me.rewardTitle, rewardCost: me.rewardCost });
      const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url; link.download = "anmeldeschild.html"; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Das Anmeldeschild konnte nicht erstellt werden."); }
  }

  if (!joinUrl) return <div className="ow-card"><h2>Kunden einladen</h2><p className="ow-muted" style={{ marginTop: 8 }}>Die öffentliche Adresse ist noch nicht konfiguriert. Der Anmeldelink ist deshalb nicht verfügbar.</p></div>;
  return (
    <section className="ow-card ow-stack" aria-labelledby="ow-join-title">
      <div><h2 id="ow-join-title">Kunden einladen</h2><p className="ow-muted" style={{ fontSize: 14, marginTop: 2 }}>Dieser Link führt zur Anmeldung für {me.locationName}.</p></div>
      <div className="ow-field"><label htmlFor="ow-join-url" className="ow-sr">Anmeldelink</label><input id="ow-join-url" className="ow-input" readOnly value={joinUrl} onFocus={event => event.currentTarget.select()} /></div>
      <div className="ow-row">
        <button type="button" className="ow-btn ow-btn--secondary" onClick={() => void copy()}>Link kopieren</button>
        <button type="button" className="ow-btn ow-btn--secondary" onClick={() => void downloadSign()}><OwnerIcon name="phone" size={18} />Tresenschild laden</button>
        {exportUrl && <a className="ow-btn ow-btn--ghost" href={exportUrl}>Datenexport</a>}
      </div>
      <div role="status" aria-live="polite">{copied && <p className="ow-muted" style={{ fontSize: 13 }}>{copied}</p>}</div>
      {error && <p className="ow-error" role="alert">{error}</p>}
    </section>
  );
}
