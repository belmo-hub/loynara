"use client";

import { ArrowRight, Check, Gift, MapPin, Megaphone, Plus, RefreshCw, Undo2, UserPlus, Users, X } from "lucide-react";
import { useState } from "react";
import { BackToActions } from "@/components/owner/actions-list";
import { useOwner } from "@/components/owner/owner-context";
import { Board, BoardPlaceholder, DemoDataChip } from "@/components/owner/overview-board";
import { ErrorNotice, LoadingBlock, nf, Notice, PageHead } from "@/components/owner/owner-ui";
import { ALL_LOCATIONS_NOTE } from "@/components/owner/period-bar";
import { SpendCard } from "@/components/owner/spend-card";
import { useLoad, type Loadable } from "@/components/owner/use-load";
import { Rows, RowSection, type ValueRow } from "@/components/owner/value-rows";
import type { AnalyticsWindowDays, MerchantAnalytics } from "@/lib/merchant-analytics";
import { bookingsText } from "@/lib/overview-day";
import { retentionCustomerHref } from "@/lib/retention-links";
import type { RetentionSummary } from "@/lib/retention";
import { germanDate as date } from "@/lib/german-date";
import { SPEND_COPY } from "@/lib/spend-copy";

const dayMonth = (value: string) => new Date(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone: "Europe/Berlin" });
// A Berlin week is an hour short across the spring clock change; a cut week is at least a day short.
const FULL_WEEK_MS = 7 * 86_400_000 - 3_600_000;
const PERIOD_SUB = "Bestätigte Buchungen im Zeitraum";

type Week = MerchantAnalytics["series"][number];

/**
 * Ergebnisse (ENG-122b, screen 07): the period segment, one white card with the period's confirmed bookings and its weeks,
 * then the old tiles and tables as rows under heads on the grey; each head's „?“ holds the live help texts.
 */
export default function MerchantAnalyticsPage() {
  const { me, locations } = useOwner();
  const [windowDays, setWindowDays] = useState<AnalyticsWindowDays>(30);
  // Bars grow on the screen's first paint only: after a period pick they stand at once (DESIGN.md, Bars grow).
  const [switched, setSwitched] = useState(false);
  const [report, reload] = useLoad<MerchantAnalytics>(me?.role === "owner" ? `/api/merchant/analytics?window=${windowDays}` : null);
  const [retention, reloadRetention] = useLoad<RetentionSummary>(me?.role === "owner" ? "/api/merchant/retention?days=30" : null);
  if (!me) return null;
  const head = <PageHead back={<BackToActions />} title="Ergebnisse" lead={locations.length > 1 ? ALL_LOCATIONS_NOTE : undefined} actions={me?.hiddenSurfaces?.includes("revenue") ? <DemoDataChip /> : undefined} />;
  if (me.role !== "owner") return <div className="ow-page">{head}<Notice>Nur die Inhaberin oder der Inhaber kann die Ergebnisse sehen.</Notice></div>;
  const r = report.state === "ok" ? report.data : null;
  // The read's bars are Monday weeks. The cut first week would read as a drop, so it stays out; the week still running
  // is shown as not final („bis heute“), so the bars hold today's bookings like the number above them.
  const full = (week: Week) => Date.parse(week.to) - Date.parse(week.from) >= FULL_WEEK_MS;
  const series = r?.series ?? [];
  const weeks = series.filter(full);
  const newest = series.at(-1);
  const running = newest && series.length > 1 && !full(newest) ? newest : undefined;
  const last = weeks.at(-1);
  const lastWasBest = Boolean(last && last.checkouts > 0 && weeks.length > 1 && weeks.slice(0, -1).every(week => week.checkouts < last.checkouts));
  return (
    <div className="ow-page ow-results ow-column">
      {head}
      <div className="ow-seg" role="group" aria-label="Zeitraum">
        {([30, 90] as const).map(days => <button key={days} type="button" aria-pressed={windowDays === days} onClick={() => { setWindowDays(days); setSwitched(true); }}>{days} Tage</button>)}
      </div>
      {report.state === "error" ? <ErrorNotice message={report.message} onRetry={reload} /> : (
        <Board label={`Bestätigte Buchungen, letzte ${windowDays} Tage`} busy={!r}>
          {!r ? <BoardPlaceholder /> : <>
            <p className="ow-board-big">{nf.format(r.qualifyingCheckouts)}{"\u00a0"}<small>{r.qualifyingCheckouts === 1 ? "Buchung" : "Buchungen"}</small></p>
            <p className="ow-board-sub">letzte {windowDays} Tage, Korrekturen abgezogen</p>
            <Weeks weeks={weeks} running={running} switched={switched} />
            {lastWasBest && <p className="ow-board-news">Die meisten Buchungen gab es letzte Woche.</p>}
          </>}
        </Board>
      )}
      {report.state === "loading" && <LoadingBlock rows={3} height={64} />}
      {r && <>
        <RowSection title="Karten und Buchungen" help={[{ text: `Zeitraum: ${date(r.from)} bis ${date(r.asOf)}` }, { text: `${r.countingRule} ${SPEND_COPY.bookingsNote}` }]}>
          <Rows rows={[
            { key: "active", icon: Users, title: "Aktive Karten aktuell", sub: "Alle Karten, die nicht geschlossen sind", value: nf.format(r.currentActiveCards) },
            { key: "new", icon: Plus, title: "Neue Karten", sub: "Im Zeitraum angemeldet.", value: nf.format(r.newCards) },
            { key: "repeat", icon: RefreshCw, title: "Wiederkehrende Karten", sub: r.participatingCards > 0 ? `${Math.round(r.repeatCards / r.participatingCards * 100)} % der Karten mit Buchung` : "Karten mit 2+ Buchungen im Zeitraum", value: nf.format(r.repeatCards) },
            { key: "redeemed", icon: Gift, title: "Einlösungen", value: nf.format(r.rewards.redemptions) },
          ]} />
        </RowSection>
        <Retention state={retention} reload={reloadRetention} />
        <RowSection title="Häufigste eingelöste Prämien">
          {r.rewards.topTitles.length
            ? <Rows rows={r.rewards.topTitles.map(item => ({ key: item.title, icon: Gift, title: item.title, value: nf.format(item.count) }))} />
            : <p className="ow-rows-note">Im Zeitraum wurde keine Prämie eingelöst.</p>}
        </RowSection>
        <RowSection title="Team" help={[{ text: "Über alle Standorte dieses Betriebs. Vollständig korrigierte Buchungen zählen nicht. Frühere Teammitglieder bleiben in der Historie. Boni wie Startbonus oder Happy Hour stehen im Export als eigene Zeilen und zählen hier nicht mit. Diese Zahlen belegen keinen Umsatz und keine Arbeitsleistung." }]}>
          {r.staffActivity.length
            ? <Rows rows={r.staffActivity.map(row => ({ key: row.userId, icon: Users, title: row.name, sub: PERIOD_SUB, value: nf.format(row.awardActions) }))} />
            : <p className="ow-rows-note">Keine Buchungen in diesem Zeitraum.{windowDays === 30 && " Wähle oben einen längeren Zeitraum."}</p>}
        </RowSection>
        {/* With one location its row would repeat the card's number. */}
        {r.locationActivity.length > 1 && <RowSection title="Aktivität je Standort" help={[{ text: "Gezählt am Standort der Buchung, mit dem heutigen Namen. Auch Buchungen aus archivierten Programmen zählen. Boni wie Startbonus oder Happy Hour stehen im Export als eigene Zeilen und zählen hier nicht mit. Keine Umsatzkennzahl." }]}>
          <Rows rows={r.locationActivity.map(row => ({ key: row.locationId, icon: MapPin, title: row.name, sub: PERIOD_SUB, value: nf.format(row.awardActions) }))} />
        </RowSection>}
        {r.referrals.attributed + r.referrals.qualified + r.referrals.reversed > 0 && <RowSection title="Empfehlungen im Zeitraum" help={[{ text: "Gewonnen ist eine Empfehlung erst mit der ersten bestätigten Buchung." }]}>
          <Rows rows={[
            { key: "attributed", icon: UserPlus, title: "Über Empfehlungslink angemeldet", value: nf.format(r.referrals.attributed) },
            { key: "qualified", icon: Check, title: "Erste Buchung bestätigt, Bonus gebucht", value: nf.format(r.referrals.qualified) },
            ...(r.referrals.reversed > 0 ? [{ key: "reversed", icon: Undo2, title: "Nach Korrektur zurückgenommen", value: nf.format(r.referrals.reversed) }] : []),
            { key: "open", icon: ArrowRight, title: "Empfehlungen ansehen", href: "/merchant/referrals" },
          ]} />
        </RowSection>}
        {r.campaignAttempts.total > 0 && <RowSection title="Kampagnenversuche" help={[{ text: "Dies zählt Versuche, nicht einzigartige Empfänger. Die Annahme bestätigt weder die Zustellung in ein echtes Postfach noch eine Öffnung." }]}>
          <Rows rows={([["total", "Insgesamt"], ["complete", "Angenommen"], ["suppressed", "Unterdrückt"], ["retry", "Erneut geplant"], ["failed", "Fehlgeschlagen"], ["blocked", "Blockiert"]] as const)
            .map(([key, title]) => ({ key, icon: Megaphone, title, value: nf.format(r.campaignAttempts[key]) }))} />
        </RowSection>}
      </>}
      {/* Withheld in the demo environment (pilot-surfaces „revenue“). */}
      {!me.hiddenSurfaces?.includes("revenue") && <SpendCard multiLocation={locations.length > 1} />}
    </div>
  );
}

/** „Kundenbindung heute“: the cards as they stand now, whatever the period; each group with cards opens it under Kunden. */
function Retention({ state, reload }: { state: Loadable<RetentionSummary>; reload: () => void }) {
  const s = state.state === "ok" ? state.data : null;
  const row = (key: string, icon: ValueRow["icon"], title: string, sub: string, count: number, href: string): ValueRow =>
    ({ key, icon, title, sub, value: nf.format(count), href: count > 0 ? href : undefined });
  return (
    <RowSection title="Kundenbindung heute" help={s && [
      { text: "Stand jetzt, unabhängig vom Zeitraum oben." },
      { title: "Länger nicht da", text: `Früher bestätigte Buchungen, seit ${s.inactiveDays}+ Tagen keine mehr.` },
      { title: "Kurz vor der Prämie", text: "„Kurz vor der Prämie“ rundet auf ganze Einheiten auf." },
    ]}>
      {state.state === "error" && <ErrorNotice message={state.message} onRetry={reload} />}
      {state.state === "loading" && <LoadingBlock rows={1} height={64} />}
      {s && <Rows rows={[
        row("drifting", RefreshCw, "Länger nicht da", `Vor einer Woche: ${s.driftingWeekAgo}.`, s.drifting, retentionCustomerHref(s, "drifting")),
        row("ready", Gift, "Prämie jetzt einlösbar", "Beim nächsten Mal an der Kasse anbieten.", s.rewardReady, retentionCustomerHref(s, "reward_ready")),
        row("near", Gift, "Kurz vor der Prämie", "Höchstens ¼ fehlt zur günstigsten Prämie", s.nearReward, retentionCustomerHref(s, "near_reward")),
        row("never", X, "Noch nie an der Kasse", `${s.neverAfterWeek} davon seit über einer Woche angemeldet.`, s.never, retentionCustomerHref(s, "never")),
      ]} />}
    </RowSection>
  );
}

/**
 * The period's full weeks as the Übersicht strip's bars: the count above each bar, the week's first day under it, the
 * latest full week lit; the week still running follows as an outline, „bis heute“. Ninety days give thirteen narrow bars,
 * so every third one from the last carries its label; the others keep an empty line, so every bar stands on the same baseline.
 * The dated label just before „bis heute“ stays empty: side by side the two read as one range.
 */
function Weeks({ weeks, running, switched }: { weeks: Week[]; running?: Week; switched: boolean }) {
  const bars = running ? [...weeks, running] : weeks;
  const max = Math.max(1, ...bars.map(week => week.checkouts));
  const many = bars.length > 7;
  return (
    <div className="ow-strip ow-weeks" data-many={many || undefined} data-switched={switched || undefined} style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}
      role="img" aria-label={`Bestätigte Buchungen je Woche: ${bars.map(week => `${dayMonth(week.from)} bis ${week === running ? "heute" : dayMonth(week.to)} ${bookingsText(week.checkouts)}`).join(", ")}`}>
      {bars.map((week, index) => {
        const latest = week === weeks.at(-1);
        return (
          <div className="ow-strip-day" key={week.from} aria-hidden="true">
            <span className="ow-strip-n">{week.checkouts > 0 ? nf.format(week.checkouts) : ""}</span>
            <span className="ow-strip-bar" data-lit={latest && week.checkouts > 0 ? "" : undefined} data-today={week === running ? "" : undefined} data-zero={week.checkouts === 0 ? "" : undefined} style={{ height: `${Math.max(6, Math.round(week.checkouts / max * 72))}px` }} />
            <span className="ow-strip-d" data-yesterday={latest && !running ? "" : undefined} data-running={week === running ? "" : undefined}>{many && ((bars.length - 1 - index) % 3 !== 0 || (running && bars.length - 1 - index === 3)) ? "\u00a0" : week === running ? "bis heute" : dayMonth(week.from)}</span>
          </div>
        );
      })}
    </div>
  );
}
