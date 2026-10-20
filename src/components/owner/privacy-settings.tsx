"use client";

import { useEffect, useState } from "react";
import { apiJson, postJson } from "../client-api";
import { Notice } from "./owner-ui";

type Review = { id: string; cardLocator: string; balance: number; flaggedAt: string };
export function PrivacySettings({ tenantId, businessName }: { tenantId: string; businessName: string }) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{ receiptId: string; deleteBy: string } | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewError, setReviewError] = useState("");
  useEffect(() => {
    let active=true;
    void apiJson<{reviews:Review[]}>("/api/merchant/inactivity").then(result=>{if(active)setReviews(result.reviews);}).catch(()=>{if(active)setReviewError("Die Prüfungsliste ist gerade nicht erreichbar.");});
    return ()=>{active=false;};
  },[]);
  async function close() {
    setBusy(true); setError("");
    try { setReceipt(await postJson("/api/merchant/close",{tenantId,confirmation})); }
    catch(cause) { setError(cause instanceof Error ? cause.message : "Das Geschäft konnte nicht geschlossen werden."); }
    finally { setBusy(false); }
  }
  async function reviewed(id:string) {
    setReviewError("");
    try { await postJson("/api/merchant/inactivity",{membershipId:id}); setReviews(current=>current.filter(row=>row.id!==id)); }
    catch { setReviewError("Die Prüfung konnte nicht gespeichert werden."); }
  }
  if(receipt) return <section className="ow-card ow-stack"><h2>Geschäft geschlossen</h2><p>Alle Zugänge und Karten sind gesperrt. Die Löschung ist bis {new Date(receipt.deleteBy).toLocaleDateString("de-DE")} vorgesehen. Gesetzliche Aufbewahrung und dokumentierte Sperren werden gesondert geprüft.</p><p>Ein bereits gespeicherter Wallet-Pass kann auf einem Gerät noch sichtbar sein.</p><a className="ow-btn ow-btn--secondary" href={`/api/privacy/receipts/${receipt.receiptId}`} download="loynara-loeschbeleg.json">Löschbeleg speichern</a><p>Belegnummer: {receipt.receiptId}</p></section>;
  return <>
    <section className="ow-card ow-stack" aria-labelledby="inactivity-title"><h2 id="inactivity-title">Inaktive Karten mit Guthaben</h2><p>Nach 24 Monaten ohne Nutzung wird Guthaben nicht automatisch gelöscht. Prüfe diese Karten monatlich anhand deiner vereinbarten Bedingungen. Eine Bestätigung ändert weder das Guthaben noch die letzte Kundennutzung.</p>
      {reviewError&&<Notice tone="warn">{reviewError}</Notice>}
      {reviews.length===0&&!reviewError?<p>Keine offenen Prüfungen.</p>:<ul>{reviews.map(row=><li key={row.id}>K-{row.cardLocator} · Guthaben {row.balance} <button className="ow-btn ow-btn--ghost ow-btn--sm" onClick={()=>void reviewed(row.id)}>Geprüft, Guthaben behalten</button></li>)}</ul>}
      {reviews.length===100&&<p>Die nächsten 100 Prüfungen werden angezeigt. Nach der Bearbeitung lade die Seite erneut.</p>}
    </section>
    <section className="ow-card ow-stack" aria-labelledby="delete-business-title"><h2 id="delete-business-title">Geschäft dauerhaft löschen</h2><p>Dies schließt <strong>{businessName}</strong> mit allen Standorten, Mitarbeiterzugängen und Kundenkarten sofort. Guthaben kann danach nicht mehr genutzt werden. Lade vorher deine Geschäftsdaten herunter.</p>
      <a className="ow-btn ow-btn--secondary" href="/api/merchant/export" download>Geschäftsdaten exportieren</a>
      <p>Lokale Daten werden innerhalb von sieben Tagen gelöscht, soweit keine dokumentierte Aufbewahrungspflicht besteht. Geschützte Sicherungen laufen nach 14 Tagen aus; Löschanweisungen verhindern eine Wiederherstellung gelöschter Karten. Wallet-Anbieter und Offline-Geräte können verzögert reagieren. Die Abwicklung eines gesonderten Zahlungs- oder Händlervertrags muss mit dem Betreiber geklärt werden.</p>
      <p>Melde dich unmittelbar vorher erneut an. Gib dann den vollständigen Geschäftsnamen ein.</p>
      <label>Geschäftsname<input className="ow-input" value={confirmation} onChange={event=>setConfirmation(event.target.value)} autoComplete="off" disabled={busy}/></label>
      {error&&<Notice tone="warn">{error}</Notice>}
      <button className="ow-btn ow-btn--danger" disabled={busy||confirmation!==businessName} onClick={()=>void close()}>{busy?"Wird geschlossen …":"Geschäft schließen und Löschung anfordern"}</button>
    </section>
  </>;
}
