"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { MeResponse } from "@/components/client-api";
import type { LocationAnalytics, MerchantSpend } from "@/lib/merchant-analytics";
import { greeting, headline, localNow, quietDays, type LocationDays } from "@/lib/overview-day";
import type { LaunchReadiness } from "@/lib/readiness";
import type { RetentionSummary } from "@/lib/retention";
import { formatMinor } from "@/lib/spend-copy";
import { CancellationNotice } from "./cancellation-notice";
import { downloadCounterSign, joinUrlOf } from "./join-card";
import { BigMoney, Board, BoardPlaceholder, CardStock, Diary, EmptyStrip, Milestone, NextBar, Strip, Tiles, type NextAction, type Tile } from "./overview-board";
import { buildInsights, type ReferralRow, type WinbackState } from "./retention-insights";
import { useOwner } from "./owner-context";
import { nf } from "./owner-ui";
import { useLoad, type Loadable } from "./use-load";

/* The Übersicht, direction D (ENG-085, founder 24 Oct): one green board, two good-news tiles, the next step, the diary. */

/** The per-location read; the day fields come with ENG-085's server part and are optional until then. */
type Analytics = LocationAnalytics & Partial<LocationDays>;

const unitOf = (me: MeResponse) => me.programType === "points" ? "Punkte" : "Stempel";
const AVERAGE_HREF = "/merchant/program";
const ASK_KEY = "loynara:average-ask-hidden-until";
const STRIP_CAPTION = "Buchungen an diesem Standort · letzte 7 Tage";
const MILESTONES = [100, 50, 25, 10, 1];
const MILESTONE_KEY = "loynara:milestones-seen";
// Steps Loynara cannot check (NFC acceptance) or that do not apply are never ticked, only named (readiness.ts).
const STEP_STATUS: Record<LaunchReadiness["steps"][number]["status"], string> = { done: "erledigt", todo: "offen", external: "außerhalb von Loynara", not_applicable: "nicht nötig" };

export function Overview() {
  const owner = useOwner();
  const me = owner.me as MeResponse;
  // Until the first booking at this location, the board guides the set-up (spec §2.4).
  return (me.stats?.awards ?? 0) === 0 ? <EmptyShop me={me} /> : <ActiveBusiness me={me} />;
}

/* ───────────── Active business ───────────── */

function ActiveBusiness({ me }: { me: MeResponse }) {
  const { locations } = useOwner();
  const isOwner = me.role === "owner";
  const [analytics, reloadAnalytics] = useLoad<Analytics>(`/api/merchant/analytics/location?locationId=${encodeURIComponent(me.locationId)}`);
  // Euros are owner-only (the spend read refuses everyone else); the Leitung's board leads with their card stock.
  const [spend, reloadSpend] = useLoad<MerchantSpend>(isOwner ? "/api/merchant/spend" : null);
  const [retention, reloadRetention] = useLoad<RetentionSummary>(`/api/merchant/retention?days=30&locationId=${encodeURIComponent(me.locationId)}`);
  const [referrals] = useLoad<{ referrals: ReferralRow[] }>(isOwner ? `/api/merchant/referrals?programSlug=${encodeURIComponent(me.programSlug)}` : null);
  const [readiness] = useLoad<LaunchReadiness>("/api/merchant/readiness");
  const [signError, setSignError] = useState("");

  const failed = [analytics, spend, retention].some(state => state.state === "error");
  const reload = () => { reloadAnalytics(); reloadSpend(); reloadRetention(); };
  const a = analytics.state === "ok" ? analytics.data : null;
  const r = retention.state === "ok" ? retention.data : null;
  const days = a?.days && a.today ? { ...a, days: a.days, today: a.today } : null;
  const hour = localNow(new Date(), a?.timezone ?? "Europe/Berlin").hour;
  const hello = `${greeting(hour)}, ${isOwner ? me.businessName : me.locationName}.`;
  const news = days ? headline({ days: days.days, lastBookingOn: days.lastBookingOn ?? null, today: days.today, fullTwoWeeks: days.fullTwoWeeks ?? false }) : null;
  const quiet = days ? quietDays(days.lastBookingOn ?? null, days.today) : null;
  const sign = () => { setSignError(""); downloadCounterSign(me).catch(cause => setSignError(cause instanceof Error ? cause.message : "Das Tresenschild konnte nicht geladen werden.")); };
  const next = nextStep({ me, retention, referrals: referrals.state === "ok" ? referrals.data.referrals : null, readiness, winback: a?.winback ?? null, quiet, sign });
  const milestone = useMilestone(me.locationId, me.stats?.members ?? 0);

  return (
    <div className="ow-page ow-dash" data-next={next ? "" : undefined}>
      <h1 className="ow-sr">Übersicht</h1>
      <div className="ow-dash-notice ow-stack"><CancellationNotice me={me} />{milestone !== null && <Milestone cards={milestone} action={sign} />}</div>
      {failed ? <ErrorCard reload={reload} /> : isOwner
        ? <OwnerBoard hello={hello} spend={spend} locationCount={locations.length} days={days?.days ?? null} news={news} />
        : <Board hello={hello} kicker="Karten an deinem Standort · 30 Tage" busy={!r}>
          {r ? <>
            <p className="ow-board-big">{nf.format(r.recent)}{" "}<small>von {nf.format(r.openCards)}</small></p>
            <p className="ow-board-sub">Karten waren in den letzten 30 Tagen da</p>
            <CardStock recent={r.recent} drifting={r.drifting} never={r.never} />
            {days && <Strip days={days.days} caption={STRIP_CAPTION} />}
            {news && <p className="ow-board-news">{news}</p>}
          </> : <BoardPlaceholder />}
        </Board>}
      <div className="ow-dash-side">
        {!failed && a && r && <Tiles tiles={isOwner ? ownerTiles(a, r) : [
          { n: nf.format(me.stats?.awards ?? 0), label: "Buchungen", note: "seit Programmstart" },
          { n: nf.format(me.stats?.members ?? 0), label: "Karten", note: "seit Programmstart" },
        ]} />}
        {next && <NextBar {...next} />}
        {signError && <p className="ow-error" role="alert">{signError}</p>}
      </div>
      <Diary diary={days?.diary ?? []} today={days?.today ?? ""} unit={unitOf(me)} gap={quiet && days?.lastBookingOn ? { from: nextDay(days.lastBookingOn), to: nextDay(days.today, -1) } : null}>
        {failed ? <p className="ow-muted">Lädt, sobald die Verbindung wieder da ist.</p> : !days && analytics.state !== "ok" ? <p className="ow-muted" aria-busy="true">Lädt …</p> : null}
      </Diary>
    </div>
  );
}

const nextDay = (date: string, by = 1) => new Date(new Date(`${date}T12:00:00Z`).getTime() + by * 86_400_000).toISOString().slice(0, 10);

function OwnerBoard({ hello, spend, locationCount, days, news }: { hello: string; spend: Loadable<MerchantSpend>; locationCount: number; days: LocationDays["days"] | null; news: string | null }) {
  const s = spend.state === "ok" ? spend.data : null;
  const recent = s?.overall.recent;
  const priced = recent ? recent.averagePerVisitMinor !== null : true;
  const [askHidden, hideAsk] = useHiddenAsk();
  const where = locationCount === 2 ? " · beide Standorte" : locationCount > 2 ? ` · alle ${locationCount} Standorte` : "";
  return (
    <Board hello={hello} kicker={priced ? "Umsatz deiner Loynara-Kunden · 30 Tage" : "Buchungen deiner Loynara-Kunden · 30 Tage"} busy={!recent}>
      {!s || !recent ? <BoardPlaceholder /> : <>
        {priced ? <>
          <BigMoney text={formatMinor(recent.spentMinor, s.currency)} />
          {/* ENG-084: name the bookings the euros were computed from, never the visits the app could not value. */}
          <p className="ow-board-sub">{recent.estimatedMinor === 0 ? "nach Kassenbeträgen" : recent.realMinor === 0 ? "geschätzt" : "teilweise geschätzt"} aus {nf.format(recent.visits - recent.unpricedVisits)}{" "}{recent.visits - recent.unpricedVisits === 1 ? "Buchung" : "Buchungen"} mit Betrag{where}</p>
        </> : <>
          <p className="ow-board-big">{nf.format(recent.visits)}{" "}<small>{recent.visits === 1 ? "Buchung" : "Buchungen"}</small></p>
          <p className="ow-board-sub">bestätigt an der Kasse{where}</p>
          {!askHidden && <div className="ow-board-ask">
            <p>Für den Umsatz in Euro fehlt nur dein Durchschnittsbon.</p>
            <div className="ow-board-actions"><Link className="ow-btn ow-btn--board ow-btn--sm" href={AVERAGE_HREF}>Durchschnittsbon eintragen</Link><button type="button" className="ow-board-textbtn" onClick={hideAsk}>Nicht jetzt</button></div>
          </div>}
        </>}
        {days && <Strip days={days} caption={STRIP_CAPTION} />}
        {news && <p className="ow-board-news">{news}</p>}
      </>}
    </Board>
  );
}

const readMilestones = () => { try { return window.localStorage.getItem(MILESTONE_KEY) ?? ""; } catch { return "-"; } };

/**
 * The highest card milestone the location reached that this browser has not shown (`seen`: the stored list); null
 * without storage ("-": server render or blocked storage), so the card can never repeat on every visit.
 */
export function milestoneToShow(cards: number, seen: string, locationId: string): number | null {
  const reached = MILESTONES.find(milestone => cards >= milestone) ?? null;
  return reached !== null && seen !== "-" && !seen.split(",").includes(`${locationId}:${reached}`) ? reached : null;
}

/** The milestone to show now, marked as shown once it is on screen (spec §4.3; v1 keeps it in this browser). */
function useMilestone(locationId: string, cards: number): number | null {
  const seen = useSyncExternalStore(onStorage, readMilestones, () => "-");
  const show = milestoneToShow(cards, seen, locationId);
  useEffect(() => {
    if (show === null) return;
    try { window.localStorage.setItem(MILESTONE_KEY, [...seen.split(",").filter(Boolean), `${locationId}:${show}`].join(",")); } catch { /* shown this once anyway */ }
  }, [show, seen, locationId]);
  return show;
}

const readAskHidden = () => { try { return Number(window.localStorage.getItem(ASK_KEY) ?? 0) > Date.now(); } catch { return false; } };
const onStorage = (notify: () => void) => { window.addEventListener("storage", notify); return () => window.removeEventListener("storage", notify); };

/** „Nicht jetzt“ hides the average ask for 30 days in this browser (spec §2.2); without storage the ask simply stays. */
function useHiddenAsk(): [boolean, () => void] {
  const stored = useSyncExternalStore(onStorage, readAskHidden, () => false);
  const [dismissed, setDismissed] = useState(false);
  return [stored || dismissed, () => {
    setDismissed(true);
    try { window.localStorage.setItem(ASK_KEY, String(Date.now() + 30 * 86_400_000)); } catch { /* storage blocked: hidden until reload */ }
  }];
}

/** Two good-news tiles: new cards when there are some, else regulars; always who was there (spec §2.1, §2.3). */
function ownerTiles(a: Analytics, r: RetentionSummary): Tile[] {
  const regulars = a.current.repeatCards;
  const there: Tile = { n: `${nf.format(r.recent)} von ${nf.format(r.openCards)}`, label: "Karten waren da", note: `in 30 Tagen${a.current.newCards > 0 && regulars > 0 ? ` · darunter ${nf.format(regulars)} Stammkunden` : ""}` };
  return a.current.newCards > 0
    ? [{ n: nf.format(a.current.newCards), label: a.current.newCards === 1 ? "neue Karte" : "neue Karten", note: `in 30 Tagen${a.previous ? ` · vorher ${nf.format(a.previous.newCards)}` : ""}` }, there]
    : [there, { n: nf.format(regulars), label: "Stammkunden", note: "2+ Buchungen in 30 Tagen" }];
}

/**
 * „Als Nächstes“: an open required set-up step first, then the most urgent observation, then a quiet week (7+ days
 * without a booking). Nothing urgent: no bar at all. While the programme is ending, the end-date card leads instead.
 */
export function nextStep(input: { me: MeResponse; retention: Loadable<RetentionSummary>; referrals: ReferralRow[] | null; readiness: Loadable<LaunchReadiness>; winback: WinbackState; quiet: number | null; sign: () => void }): { title: string; text?: string; action?: NextAction } | null {
  const { me, retention, referrals, readiness, winback, quiet, sign } = input;
  const isOwner = me.role === "owner";
  if (me.cancellationEndDate || retention.state !== "ok" || readiness.state !== "ok") return null;
  // The step's evidence is its action sentence (#129); its title stays on the Startklar list.
  const setup = readiness.data.steps.find(step => step.required && step.status === "todo" && step.action && (isOwner || !step.action.ownerOnly));
  if (setup) return { title: setup.evidence, action: setup.action ?? undefined };
  const insight = buildInsights({ summary: retention.data, unit: unitOf(me), isOwner, campaigns: !(me.hiddenSurfaces ?? []).includes("campaigns"), referrals, winback })[0];
  if (insight) return { title: `${insight.title}.`, text: insight.next, action: insight.actions.at(-1) };
  if (quiet !== null) return { title: `Seit ${quiet} Tagen keine Buchung.`, text: "Steht das Tresenschild noch gut sichtbar an der Kasse?", action: { label: "Tresenschild", onClick: sign } };
  return null;
}

function ErrorCard({ reload }: { reload: () => void }) {
  return (
    <section className="ow-card ow-stack ow-dash-error" role="alert">
      <h2>Die Zahlen sind gerade nicht da.</h2>
      <p>Die Verbindung zu Loynara hat nicht geklappt. Buchen an der Kasse geht trotzdem.</p>
      <div><button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={reload}>Erneut laden</button></div>
    </section>
  );
}

/* ───────────── Empty shop: the board guides the first required step ───────────── */

function EmptyShop({ me }: { me: MeResponse }) {
  const isOwner = me.role === "owner";
  const [readiness, reloadReadiness] = useLoad<LaunchReadiness>("/api/merchant/readiness");
  const [signError, setSignError] = useState("");
  const today = localNow(new Date(), "Europe/Berlin").date;
  const steps = readiness.state === "ok" ? readiness.data.steps : [];
  const current = steps.find(step => step.required && step.status === "todo");
  const sign = () => { setSignError(""); downloadCounterSign(me).catch(cause => setSignError(cause instanceof Error ? cause.message : "Das Tresenschild konnte nicht geladen werden.")); };
  const joinUrl = joinUrlOf(me);
  const lead = !current ? null
    : current.id === "enrolment" ? { title: "Melde die erste Karte selbst an.", text: "Mit deinem eigenen Handy. So siehst du, was deine Kundinnen und Kunden sehen.", action: joinUrl ? <a className="ow-btn ow-btn--board ow-btn--sm" href={joinUrl} target="_blank" rel="noopener noreferrer">Anmeldelink öffnen</a> : null }
      : current.id === "first_award" ? { title: me.programType === "points" ? "Buch die ersten Punkte an der Kasse." : "Buch den ersten Stempel an der Kasse.", text: "Auf deine eigene Karte: Kasse öffnen, Karte zeigen, buchen.", action: <Link className="ow-btn ow-btn--board ow-btn--sm" href="/cashier">Kasse öffnen</Link> }
        : { title: current.evidence, text: undefined, action: current.action ? <Link className="ow-btn ow-btn--board ow-btn--sm" href={current.action.href}>{current.action.label}</Link> : null };
  return (
    <div className="ow-page ow-dash ow-dash--single">
      <h1 className="ow-sr">Dein Treueprogramm einrichten</h1>
      <div className="ow-dash-notice"><CancellationNotice me={me} /></div>
      <Board hello={`Willkommen bei Loynara, ${me.businessName}.`} kicker={readiness.state === "ok" ? `Startklar · ${readiness.data.requiredDone} von ${readiness.data.requiredTotal} Pflichtschritten` : "Startklar"} busy={readiness.state !== "ok" && readiness.state !== "error"}>
        {readiness.state === "error" ? <div className="ow-board-ask"><p>Die Schritte sind gerade nicht da.</p><div><button type="button" className="ow-btn ow-btn--board ow-btn--sm" onClick={reloadReadiness}>Erneut laden</button></div></div>
          : readiness.state !== "ok" ? <BoardPlaceholder />
            : lead && <>
              <p className="ow-board-title">{lead.title}</p>
              {lead.text && <p className="ow-board-sub">{lead.text}</p>}
              {lead.action && <div className="ow-board-actions" style={{ marginTop: 16 }}>{lead.action}</div>}
            </>}
        <EmptyStrip today={today} caption="Hier siehst du bald jeden Tag am Tresen." />
      </Board>
      <section className="ow-diary" aria-labelledby="ow-steps-title">
        <h2 id="ow-steps-title">Deine ersten Schritte</h2>
        {steps.map(step => (
          <div className="ow-day" key={step.id} data-state={step.status === "done" ? undefined : step === current ? "current" : "open"}>
            <div className="ow-day-rail" aria-hidden="true"><i /><span /></div>
            <div>
              <h3>{step.title}{step.required && step.status !== "done" && <span className="ow-chip" style={{ marginLeft: 8 }}>Pflicht</span>}<span className="ow-sr"> ({STEP_STATUS[step.status]})</span></h3>
              <p className="ow-day-sum">{step.evidence}</p>
              {step.note && step.status !== "done" && <p className="ow-day-sum">{step.note}</p>}
            </div>
          </div>
        ))}
        <h2 style={{ marginTop: 32 }}>Wenn du magst</h2>
        <div className="ow-row" style={{ marginTop: 8 }}>
          {isOwner && <Link className="ow-btn ow-btn--secondary ow-btn--sm" href="/merchant/program/card">Karte gestalten</Link>}
          {isOwner && <Link className="ow-btn ow-btn--secondary ow-btn--sm" href="/merchant/staff">Team einladen</Link>}
          <button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={sign}>Tresenschild laden</button>
        </div>
        {signError && <p className="ow-error" role="alert">{signError}</p>}
      </section>
    </div>
  );
}
