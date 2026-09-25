"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiJson, ClientApiError, type MeResponse } from "@/components/client-api";
import { BrandMark } from "@/components/loyalty-ui";
import type { MerchantAdvice } from "@/lib/adviser";
import styles from "./adviser.module.css";

function day(value: string) {
  return new Date(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

export default function MerchantAdviserPage() {
  const router = useRouter();
  const [windowDays, setWindowDays] = useState<30 | 90>(30);
  const [report, setReport] = useState<MerchantAdvice | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void apiJson<MeResponse>("/api/me").then(account => {
      if (!active) return null;
      if (account.role !== "owner") { setForbidden(true); setLoading(false); return null; }
      if (!account.programSlug) { router.replace("/merchant/program"); return null; }
      return apiJson<MerchantAdvice>(`/api/merchant/adviser?window=${windowDays}`);
    }).then(result => {
      if (!active || !result) return;
      setReport(result);
      setLoading(false);
    }).catch(cause => {
      if (!active) return;
      if (cause instanceof ClientApiError && cause.status === 401) { router.replace("/login"); return; }
      if (cause instanceof ClientApiError && cause.status === 403) { setForbidden(true); setLoading(false); return; }
      setError(cause instanceof Error ? cause.message : "Die Beratung konnte nicht geladen werden.");
      setLoading(false);
    });
    return () => { active = false; };
  }, [router, windowDays]);

  return <div className="app-page">
    <header className={`app-header ${styles.header}`}><div className="app-header-inner"><Link href="/merchant" aria-label="Zur Übersicht"><BrandMark /></Link><nav aria-label="Hauptnavigation"><Link href="/merchant">Übersicht</Link><Link href="/merchant/program">Programm</Link><Link href="/merchant/customers">Kundenkarten</Link><Link href="/merchant/analytics">Auswertung</Link><Link href="/merchant/adviser" aria-current="page">Beratung</Link><Link href="/cashier">Kasse</Link></nav><span className="app-header-location">Beratung</span></div></header>
    <main className={`app-container ${styles.main}`}>
      <div className="app-intro"><span className="eyebrow"><span className="eyebrow-dot" /> REGELBASIERTE HINWEISE</span><h1>Beratung</h1><p>Prüfbare Hinweise aus den bestätigten Vorgängen deines Betriebs. Jede Änderung bleibt deine Entscheidung.</p></div>
      <div className={styles.toolbar}><label htmlFor="adviser-window">Zeitraum</label><select id="adviser-window" value={windowDays} onChange={event => { setReport(null); setError(""); setLoading(true); setWindowDays(Number(event.target.value) as 30 | 90); }}><option value={30}>Letzte 30 Tage</option><option value={90}>Letzte 90 Tage</option></select>{report && <span>{day(report.from)} bis {day(report.asOf)} · UTC</span>}</div>
      {loading ? <section className="app-panel"><p role="status">Hinweise werden geladen …</p></section> : forbidden ? <section className="app-panel"><p role="alert">Nur Inhaberinnen und Inhaber können diese Hinweise sehen.</p></section> : error ? <section className="app-panel"><p role="alert">{error}</p></section> : report && <>
        <div className={styles.mode}><strong>Regelbasiert</strong><span>Diese Hinweise folgen festen, sichtbaren Regeln. Eine Modellanbindung ist nicht aktiv.</span></div>
        <section className={styles.metrics} aria-label="Beobachtete Kennzahlen">
          <Metric label="Aktive Karten" value={report.metrics.currentActiveCards} />
          <Metric label="Bestätigte Kassenvorgänge" value={report.metrics.qualifyingCheckouts} />
          <Metric label="Wiederkehrende Karten" value={report.metrics.repeatCards} />
          <Metric label="Einlösungen" value={report.metrics.redemptions} />
        </section>
        <section aria-labelledby="advice-heading"><h2 id="advice-heading" className={styles.sectionTitle}>Prüfpunkte</h2><div className={styles.cards}>{report.recommendations.map(item => <article className={`app-panel ${styles.advice}`} key={item.id}><h3>{item.title}</h3><dl className={styles.observed}>{item.observed.map(observation => <div key={observation.label}><dt>{observation.label}</dt><dd>{observation.value}</dd></div>)}</dl><div className={styles.explanation}><h4>Warum dieser Hinweis?</h4><p>{item.reasoning}</p></div><div className={styles.explanation}><h4>Was fehlt?</h4><ul>{item.missingInformation.map(value => <li key={value}>{value}</li>)}</ul></div><div className={styles.next}><h4>Nächster Schritt zur Prüfung</h4><p>{item.nextAction}</p></div></article>)}</div></section>
        <aside className={styles.limits}><h2>Datengrenzen</h2><ul>{report.limitations.map(value => <li key={value}>{value}</li>)}</ul><p><Link href="/merchant/analytics">Zählregeln in der Auswertung ansehen</Link> · <Link href="/merchant/program">Programm manuell öffnen</Link></p></aside>
      </>}
    </main>
  </div>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className={`app-panel ${styles.metric}`}><span>{label}</span><strong>{value}</strong></div>;
}
