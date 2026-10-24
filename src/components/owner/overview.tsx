"use client";

import Link from "next/link";
import type { MeResponse } from "@/components/client-api";
import type { LocationAnalytics } from "@/lib/merchant-analytics";
import type { LaunchReadiness } from "@/lib/readiness";
import type { RetentionSummary } from "@/lib/retention";
import { BrowserCardPreview } from "./card-preview";
import { CancellationNotice } from "./cancellation-notice";
import { JoinCard } from "./join-card";
import { ReadinessCard } from "./readiness-card";
import { buildInsights, RetentionInsights, type ReferralRow, type WinbackState } from "./retention-insights";
import { useOwner } from "./owner-context";
import { germanDate, nf, Skeleton, OwnerIcon } from "./owner-ui";
import { useLoad, type Loadable } from "./use-load";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClassName } from "@/components/ui/button";
import { NumberRoll } from "@/components/ui/number-roll";

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
        <div><h1>Dein Treueprogramm einrichten</h1><p>Jeder Schritt zeigt, was bereits gespeichert oder an der Kasse belegt ist. Alles lässt sich später ändern.</p></div>
      </header>
      <CancellationNotice me={me} />
      <div className="ow-two">
        <div className="ow-stack">
          <ReadinessCard readiness={readiness} reload={reloadReadiness} isOwner={isOwner} />
        </div>
        <aside className="ow-stack" aria-label="Vorschau und Einladung">
          <section className="ow-card ow-stack" aria-labelledby="ow-prev-title">
            <div><h2 id="ow-prev-title">So sieht die Karte aus</h2><p className="ow-muted" style={{ fontSize: "var(--text-14)" }}>Browserkarte deiner Kunden, Beispielstand.</p></div>
            {brand.state === "loading" ? <Skeleton height={176} /> : <BrowserCardPreview showCode={false} businessName={me.businessName} locationName={me.locationName} brandColor={brand.state === "ok" ? brand.data.brandColor : "#1f4a3a"} programType={me.programType} rewardTitle={me.rewardTitle} rewardCost={me.rewardCost} balance={Math.min(2, Math.max(0, me.rewardCost - 1))} />}
          </section>
          <JoinCard me={me} exportUrl={undefined} />
        </aside>
      </div>
    </div>
  );
}

/* ───────────── Active business ───────────── */

function ActiveBusiness({ me }: { me: MeResponse }) {
  const isOwner = me.role === "owner";
  // One layout for every owner and manager (L1): this location's last 30 days. A true "this week" needs a 7-day window (follow-up).
  const [analytics, reloadAnalytics] = useLoad<LocationAnalytics>(`/api/merchant/analytics/location?locationId=${encodeURIComponent(me.locationId)}`);
  const winback: WinbackState = analytics.state === "ok" ? analytics.data.winback : null;
  const slug = encodeURIComponent(me.programSlug);
  // Retention insights need no campaign surface: they read recorded checkouts and link to real pages (customers,
  // referrals; campaign drafts only where that surface is offered).
  const [retention, reloadRetention] = useLoad<RetentionSummary>(`/api/merchant/retention?days=30&locationId=${encodeURIComponent(me.locationId)}`);
  const [referrals] = useLoad<{ referrals: ReferralRow[] }>(isOwner ? `/api/merchant/referrals?programSlug=${slug}` : null);
  const [readiness, reloadReadiness] = useLoad<LaunchReadiness>("/api/merchant/readiness");

  const asOf = analytics.state === "ok" ? analytics.data.asOf : undefined;
  // While a required set-up step is open it leads "Als Nächstes"; otherwise the first insight does and leaves the list.
  const setup = readiness.state === "ok" ? readiness.data.steps.find(step => step.required && step.status === "todo" && step.action && (isOwner || !step.action.ownerOnly)) : undefined;
  return (
    <div className="ow-page">
      <header className="ow-pagehead">
        <div>
          <h1>Übersicht</h1>
          <p>In den letzten 30 Tagen.{asOf ? ` Stand ${germanDate(asOf, true)}.` : ""}{isOwner && <> <Link className="ow-link ow-link--block" href="/merchant/analytics">Alle Zahlen und Zeiträume</Link></>}</p>
        </div>
      </header>

      <CancellationNotice me={me} />
      <PeriodMetrics analytics={analytics} reload={reloadAnalytics} />
      <NextStep me={me} retention={retention} referrals={referrals.state === "ok" ? referrals.data.referrals : null} readiness={readiness} setup={setup} winback={winback} />

      <div className="ow-two">
        <div className="ow-stack">
          <RetentionInsights me={me} summary={retention} referrals={referrals.state === "ok" ? referrals.data.referrals : null} winback={winback} reload={reloadRetention} skipFirst={!me.cancellationEndDate && !setup && readiness.state === "ok"} />
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
  return <span className="ow-metric-value"><NumberRoll value={state.data}>{nf.format(state.data)}</NumberRoll></span>;
}
type Counts = LocationAnalytics["current"];
const pick = (state: Loadable<LocationAnalytics>, key: keyof Counts): Loadable<number> => state.state === "ok" ? { state: "ok", data: state.data.current[key], at: state.at } : state.state === "error" ? state : { state: "loading" };

/**
 * The three numbers that matter in a shop's first weeks (Product, 22 Oct) for this location; everything else lives on
 * Ergebnisse. The previous 30 days only once there is a full previous period, as a number, never a percentage (O7).
 */
function PeriodMetrics({ analytics, reload }: { analytics: Loadable<LocationAnalytics>; reload: () => void }) {
  const previous = analytics.state === "ok" ? analytics.data.previous : null;
  const note = (text: string, key: keyof Counts) => previous ? `${text} · vorher ${nf.format(previous[key])}` : text;
  return (
    <dl className="ow-metrics ow-metrics--three" aria-label="Kennzahlen, letzte 30 Tage" aria-busy={analytics.state === "loading"}>
      <Metric label="Neue Karten" note={note("erstmals angemeldet", "newCards")}>{value(pick(analytics, "newCards"), reload)}</Metric>
      <Metric label="Buchungen" note={note("bestätigt an deiner Kasse", "qualifyingCheckouts")}>{value(pick(analytics, "qualifyingCheckouts"), reload)}</Metric>
      <Metric label="Stammkunden" note={note("Karten mit 2+ Buchungen", "repeatCards")}>{value(pick(analytics, "repeatCards"), reload)}</Metric>
    </dl>
  );
}

/**
 * One sentence and one next step. While a required set-up step is open, that step leads (a shop with all zeros needs
 * set-up, not insight); afterwards the most urgent observation from "Was jetzt zählt", with its main action.
 */
export function NextStep({ me, retention, referrals, readiness, setup, winback }: { me: MeResponse; retention: Loadable<RetentionSummary>; referrals: ReferralRow[] | null; readiness: Loadable<LaunchReadiness>; setup?: LaunchReadiness["steps"][number]; winback?: WinbackState }) {
  const isOwner = me.role === "owner";
  // While the programme is ending, the end-date card above is the one leading card with one job.
  if (me.cancellationEndDate) return null;
  if (retention.state !== "ok" || readiness.state !== "ok") {
    return retention.state === "error" || readiness.state === "error" ? null : <Skeleton height={112} />;
  }
  const insight = buildInsights({ summary: retention.data, unit: unitOf(me), isOwner, campaigns: !(me.hiddenSurfaces ?? []).includes("campaigns"), referrals, winback })[0];
  // The step's evidence is its action sentence (#129); its title stays on the Startklar card.
  const next = setup ? { text: setup.evidence, action: setup.action }
    : insight ? { text: `${insight.title}.${insight.next ? ` ${insight.next}` : ""}`, action: insight.actions.at(-1) }
      : { text: "Gerade nichts Dringendes. Dein Team bucht, die Zahlen oben zeigen, wie es läuft.", action: undefined };
  return (
    <section className="ow-card ow-next" aria-labelledby="ow-next-title">
      <h2 id="ow-next-title" className="ow-eyebrow">Als Nächstes</h2>
      <p className="ow-next-text">{next.text}</p>
      {next.action && <div><Link className="ow-btn ow-btn--primary" href={next.action.href}>{next.action.label}</Link></div>}
    </section>
  );
}

function RecentActivity({ me }: { me: MeResponse }) {
  const unit = unitOf(me);
  const items = (me.activity ?? []).slice(0, 8);
  const label = (kind: string) => kind === "award" ? "Buchung" : kind === "reversal" ? "Korrektur" : "Prämie eingelöst";
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
