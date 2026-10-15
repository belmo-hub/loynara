"use client";

import Link from "next/link";
import { useState } from "react";
import type { MeResponse } from "@/components/client-api";
import type { LaunchReadiness } from "@/lib/readiness";
import type { RetentionSummary } from "@/lib/retention";
import { BrowserCardPreview } from "./card-preview";
import { JoinCard } from "./join-card";
import { ReadinessCard } from "./readiness-card";
import { RetentionInsights, type ReferralRow } from "./retention-insights";
import { useOwner } from "./owner-context";
import { germanDate, nf, Skeleton, OwnerIcon } from "./owner-ui";
import { useLoad, type Loadable } from "./use-load";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClassName } from "@/components/ui/button";

type Analytics = { currentActiveCards: number; newCards: number; qualifyingCheckouts: number; participatingCards: number; repeatCards: number; rewards: { redemptions: number }; asOf: string; countingRule: string };
type Brand = { brandColor: string; logoData: string | null };

const unitOf = (me: MeResponse) => me.programType === "points" ? "Punkte" : "Stempel";

export function Overview() {
  const owner = useOwner();
  const me = owner.me as MeResponse;
  const isNew = (me.stats?.members ?? 0) === 0 && (me.stats?.awards ?? 0) === 0;
  return isNew ? <NewBusiness me={me} /> : <ActiveBusiness me={me} />;
}

/* ───────────── New business: setup first, no wall of zeros ───────────── */

function NewBusiness({ me }: { me: MeResponse }) {
  const isOwner = me.role === "owner";
  const [brand] = useLoad<Brand>(isOwner ? `/api/merchant/program/brand?programSlug=${encodeURIComponent(me.programSlug)}` : null);
  const [readiness, reloadReadiness] = useLoad<LaunchReadiness>("/api/merchant/readiness");
  return (
    <div className="ow-page">
      <header className="ow-pagehead">
        <div><p className="ow-eyebrow">{me.locationName}</p><h1>Dein Treueprogramm einrichten</h1><p>Jeder Schritt zeigt, was bereits gespeichert oder an der Kasse belegt ist. Alles lässt sich später ändern.</p></div>
      </header>
      <div className="ow-two">
        <div className="ow-stack">
          <ReadinessCard readiness={readiness} reload={reloadReadiness} isOwner={isOwner} />
        </div>
        <aside className="ow-stack" aria-label="Vorschau und Einladung">
          <section className="ow-card ow-stack" aria-labelledby="ow-prev-title">
            <div><h2 id="ow-prev-title">So sieht die Karte aus</h2><p className="ow-muted" style={{ fontSize: 14 }}>Browserkarte deiner Kunden, Beispielstand.</p></div>
            {brand.state === "loading" ? <Skeleton height={176} /> : <BrowserCardPreview businessName={me.businessName} locationName={me.locationName} brandColor={brand.state === "ok" ? brand.data.brandColor : "#1f4a3a"} programType={me.programType} rewardTitle={me.rewardTitle} rewardCost={me.rewardCost} balance={Math.min(2, Math.max(0, me.rewardCost - 1))} />}
          </section>
          <JoinCard me={me} exportUrl={undefined} />
        </aside>
      </div>
    </div>
  );
}

/* ───────────── Active business ───────────── */

function ActiveBusiness({ me }: { me: MeResponse }) {
  const owner = useOwner();
  const isOwner = me.role === "owner";
  const periodMode = isOwner && owner.locations.length === 1;
  const [windowDays, setWindowDays] = useState<30 | 90>(30);
  const [analytics, reloadAnalytics] = useLoad<Analytics>(periodMode ? `/api/merchant/analytics?window=${windowDays}` : null);
  const slug = encodeURIComponent(me.programSlug);
  // Retention insights need no campaign surface: they read recorded checkouts and link to real pages (customers,
  // referrals; campaign drafts only where that surface is offered).
  const [retention, reloadRetention] = useLoad<RetentionSummary>(`/api/merchant/retention?days=30&locationId=${encodeURIComponent(me.locationId)}`);
  const [referrals, reloadReferrals] = useLoad<{ referrals: ReferralRow[] }>(isOwner ? `/api/merchant/referrals?programSlug=${slug}` : null);
  const [readiness, reloadReadiness] = useLoad<LaunchReadiness>("/api/merchant/readiness");
  const [refreshing, setRefreshing] = useState(false);

  async function refreshAll() {
    setRefreshing(true);
    await owner.refresh();
    reloadAnalytics(); reloadRetention(); reloadReferrals(); reloadReadiness();
    setRefreshing(false);
    owner.announce("Übersicht aktualisiert.");
  }

  const asOf = analytics.state === "ok" ? analytics.data.asOf : undefined;
  return (
    <div className="ow-page">
      <header className="ow-pagehead">
        <div>
          <p className="ow-eyebrow">{me.locationName}</p>
          <h1>Übersicht</h1>
          <p>{periodMode ? `Zeitraum: letzte ${windowDays} Tage.` : "Zahlen dieses Standorts seit Programmstart."}{asOf ? ` Stand ${germanDate(asOf, true)}.` : ""}{isOwner && !periodMode && owner.locations.length > 1 && <> Zeiträume für alle Standorte findest du unter <Link className="ow-link" href="/merchant/analytics">Ergebnisse</Link>.</>}</p>
        </div>
        <div className="ow-row">
          {periodMode && <div className="ow-seg" role="group" aria-label="Zeitraum">{([30, 90] as const).map(days => <button key={days} type="button" aria-pressed={windowDays === days} onClick={() => setWindowDays(days)}>{days} Tage</button>)}</div>}
          <button type="button" className="ow-btn ow-btn--secondary" onClick={() => void refreshAll()} disabled={refreshing}>{refreshing ? "Aktualisiert …" : "Aktualisieren"}</button>
        </div>
      </header>

      {periodMode ? <PeriodMetrics analytics={analytics} days={windowDays} reload={reloadAnalytics} /> : <LifetimeMetrics me={me} />}
      {periodMode && analytics.state === "ok" && (
        <details className="ow-muted"><summary style={{ cursor: "pointer", minHeight: 44 }}>So zählen wir</summary><p style={{ marginTop: 6, maxWidth: "80ch" }}>{analytics.data.countingRule}</p></details>
      )}

      <div className="ow-two">
        <div className="ow-stack">
          <RetentionInsights me={me} summary={retention} referrals={referrals.state === "ok" ? referrals.data.referrals : null} reload={reloadRetention} />
          <ReadinessCard readiness={readiness} reload={reloadReadiness} isOwner={isOwner} compact />
          <RecentActivity me={me} />
        </div>
        <aside className="ow-stack" aria-label="Programm und Einladung">
          <ProgrammeCard me={me} />
          <JoinCard me={me} exportUrl={isOwner ? "/api/merchant/export" : undefined} />
        </aside>
      </div>
    </div>
  );
}

function Metric({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return <div className="ow-metric"><dt>{label}</dt><dd>{children}</dd>{note && <dd className="ow-metric-note">{note}</dd>}</div>;
}
function value(state: Loadable<number>, reload?: () => void) {
  if (state.state === "loading" || state.state === "idle") return <Skeleton height={32} width={72} />;
  if (state.state === "error") return <><span className="ow-metric-value ow-metric-value--muted">Nicht verfügbar</span>{reload && <div><button type="button" className="ow-link" style={{ background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer", minHeight: 44 }} onClick={reload}>Erneut laden</button></div>}</>;
  return <span className="ow-metric-value">{nf.format(state.data)}</span>;
}
const pick = (state: Loadable<Analytics>, read: (data: Analytics) => number): Loadable<number> => state.state === "ok" ? { state: "ok", data: read(state.data), at: state.at } : state.state === "error" ? state : { state: "loading" };

function PeriodMetrics({ analytics, days, reload }: { analytics: Loadable<Analytics>; days: number; reload: () => void }) {
  const data = analytics.state === "ok" ? analytics.data : null;
  return (
    <dl className="ow-metrics" aria-label={`Kennzahlen, letzte ${days} Tage`} aria-busy={analytics.state === "loading"}>
      <Metric label="Aktive Karten" note="Stand jetzt, nicht geschlossen">{value(pick(analytics, d => d.currentActiveCards), reload)}</Metric>
      <Metric label="Neue Karten" note={`Angemeldet in den letzten ${days} Tagen`}>{value(pick(analytics, d => d.newCards), reload)}</Metric>
      <Metric label="Bestätigte Gutschriften" note={data ? `${nf.format(data.participatingCards)} Karten, ${nf.format(data.repeatCards)} mit mehreren. Kein Umsatz.` : "Vorgänge mit Stempel oder Punkten"}>{value(pick(analytics, d => d.qualifyingCheckouts), reload)}</Metric>
      <Metric label="Eingelöste Prämien" note={`In den letzten ${days} Tagen`}>{value(pick(analytics, d => d.rewards.redemptions), reload)}</Metric>
    </dl>
  );
}

function LifetimeMetrics({ me }: { me: MeResponse }) {
  const stats = me.stats;
  const ok = (n: number | undefined): Loadable<number> => n === undefined ? { state: "error", message: "" } : { state: "ok", data: n, at: 0 };
  return (
    <dl className="ow-metrics ow-metrics--auto" aria-label="Kennzahlen seit Programmstart">
      <Metric label="Karten" note="Seit Programmstart">{value(ok(stats?.members))}</Metric>
      <Metric label="Gutschrift-Buchungen" note="Stempel- oder Punktebuchungen, kein Umsatz.">{value(ok(stats?.awards))}</Metric>
      <Metric label="Eingelöste Prämien" note="Seit Programmstart">{value(ok(stats?.redemptions))}</Metric>
    </dl>
  );
}

function RecentActivity({ me }: { me: MeResponse }) {
  const unit = unitOf(me);
  const items = (me.activity ?? []).slice(0, 8);
  const label = (kind: string) => kind === "award" ? "Gutschrift" : kind === "reversal" ? "Korrektur" : "Prämie eingelöst";
  return (
    <section className="ow-card" aria-labelledby="ow-act-title">
      <div className="ow-card-head"><div><h2 id="ow-act-title">Letzte Vorgänge</h2><p>Am Standort {me.locationName}</p></div></div>
      {items.length === 0 ? <EmptyState level={3} icon={<OwnerIcon name="till" size={24} />} title="Noch keine Vorgänge." action={<Link href="/cashier" className={buttonClassName({ variant: "secondary", size: "sm" })}>Kasse öffnen</Link>}>Sobald dein Team an der Kasse den ersten Besuch bucht, steht er hier.</EmptyState> : (
        <ul className="ow-feed">
          {items.map(item => {
            const when = item.createdAt;
            const delta = item.delta ?? item.amount;
            return <li key={item.id}><span><strong>{label(item.kind)}</strong>{item.kind === "award" && typeof delta === "number" && <span className="ow-muted ow-num"> · +{Math.abs(delta)} {unit}</span>}</span><time dateTime={when}>{item.occurredAt || germanDate(when || "", true)}</time></li>;
          })}
        </ul>
      )}
    </section>
  );
}

function ProgrammeCard({ me }: { me: MeResponse }) {
  const tap = me.tapMode === "automatic_fixed" ? "Automatisch" : me.tapMode === "staff_confirmed" ? "Mit Bestätigung" : me.tapMode === "disabled" ? "Aus" : null;
  return (
    <section className="ow-card ow-card--flat ow-stack" aria-labelledby="ow-prog-title">
      <div className="ow-card-head" style={{ marginBottom: 0 }}><h2 id="ow-prog-title">Programm</h2><span className="ow-chip ow-chip--ok"><span className="ow-dot" aria-hidden="true" />Aktiv</span></div>
      <dl className="ow-dl">
        <dt>Art</dt><dd>{me.programType === "stamp" ? "Stempelkarte" : "Punktekarte"}</dd>
        <dt>Prämie</dt><dd>{me.rewardCost} {unitOf(me)} → {me.rewardTitle}</dd>
        {tap && !(me.hiddenSurfaces ?? []).includes("nfc") && <><dt>NFC-Tap</dt><dd>{tap}</dd></>}
      </dl>
      <div><Link className="ow-btn ow-btn--secondary ow-btn--sm" href="/merchant/program">{me.role === "owner" ? "Programm bearbeiten" : "Programm ansehen"}</Link></div>
    </section>
  );
}
