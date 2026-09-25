"use client";

import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import { apiJson, imageToDataUrl, postJson, type PublicProgram } from "./client-api";
import styles from "./merchant-brand-editor.module.css";

type Brand = { businessName: string; locationName: string; brandColor: string; logoData: string | null };

function readableTextColor(hex: string) {
  const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const channels = rgb.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 > 0.179 ? "#162b24" : "#ffffff";
}

export function MerchantBrandEditor({ programSlug, program, onSaved }: { programSlug: string; program: PublicProgram; onSaved: () => Promise<void> }) {
  const [brand, setBrand] = useState<Brand>({ businessName: program.businessName, locationName: program.locationName, brandColor: program.brandColor ?? "#264C45", logoData: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void apiJson<Brand>(`/api/merchant/program/brand?programSlug=${encodeURIComponent(programSlug)}`)
      .then(result => { if (active) setBrand(result); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Markendaten konnten nicht geladen werden."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [programSlug]);

  async function selectLogo(file: File | undefined) {
    if (!file) return;
    setError(""); setMessage("");
    try { const logoData = await imageToDataUrl(file); setBrand(current => ({ ...current, logoData })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Logo konnte nicht gelesen werden."); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const saved = await postJson<Brand>("/api/merchant/program/brand", { programSlug, ...brand });
      setBrand(saved);
      setMessage("Markenauftritt gespeichert. Öffentliche Programmseite und Browserkarte verwenden jetzt Namen und Farbe.");
      try { await onSaved(); }
      catch { setError("Gespeichert, aber die Programmübersicht konnte nicht aktualisiert werden. Bitte lade die Seite neu."); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Markenauftritt konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }

  return <section className={`app-panel ${styles.panel}`} aria-labelledby="brand-heading">
    <div className="panel-head"><span className="step-number">●</span><div><h2 id="brand-heading">Markenauftritt</h2><p>Name und Farbe erscheinen auf Programmseite und Browserkarte.</p></div></div>
    {loading ? <p>Markenauftritt wird geladen …</p> : <div className={styles.grid}>
      <form className={styles.form} onSubmit={save}>
        <label>Geschäftsname<input value={brand.businessName} onChange={event => setBrand(current => ({ ...current, businessName: event.target.value }))} minLength={2} maxLength={180} required /></label>
        <label>Standortname<input value={brand.locationName} onChange={event => setBrand(current => ({ ...current, locationName: event.target.value }))} minLength={2} maxLength={180} required /></label>
        <label>Markenfarbe<input type="color" value={brand.brandColor} onChange={event => setBrand(current => ({ ...current, brandColor: event.target.value }))} aria-label="Markenfarbe" /></label>
        <label>Logo für den gespeicherten Markenauftritt<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => void selectLogo(event.target.files?.[0])} /><small>PNG, JPG oder WebP bis 2 MB. Das Logo erscheint derzeit in dieser Vorschau; die Browserkarte nutzt Name und Farbe. Google Wallet benötigt später eine genehmigte öffentliche Bildadresse.</small></label>
        {brand.logoData && <button type="button" className="button button--outline button--small" onClick={() => setBrand(current => ({ ...current, logoData: null }))}>Logo entfernen</button>}
        <button type="submit" className="button button--ink" disabled={busy}>{busy ? "Speichert …" : "Markenauftritt speichern"}</button>
        {message && <p role="status" className={styles.success}>{message}</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </form>
      <div className={styles.previewWrap}><span className="tiny-label">LIVE-VORSCHAU</span><div className={styles.preview} style={{ backgroundColor: brand.brandColor, color: readableTextColor(brand.brandColor) }}>
        <div className={styles.previewHead}>{brand.logoData ? <Image unoptimized src={brand.logoData} width={42} height={42} alt="Gespeichertes Geschäftslogo" /> : <span aria-hidden="true">●</span>}<small>{program.programType === "stamp" ? "STEMPELKARTE" : "PUNKTEKARTE"}</small></div>
        <strong>{brand.businessName || "Dein Geschäft"}</strong><span>{brand.locationName || "Dein Standort"}</span>
        <div className={styles.previewFoot}><span>0 {program.programType === "stamp" ? "Stempel" : "Punkte"}</span><span>Prämie ab {program.rewards[0]?.cost ?? program.rewardCost}</span></div>
      </div><p>Darstellung ohne echte Mitgliedschaft. Der QR-Code und der aktuelle Kontostand bleiben auf der tatsächlichen Karte sichtbar.</p></div>
    </div>}
  </section>;
}
