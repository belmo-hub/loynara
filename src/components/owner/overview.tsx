"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { MeResponse } from "@/components/client-api";
import { boardCacheKey, readBoardCache, seenCardsKey, standLabel, writeBoardCache, type BoardData } from "@/lib/board-cache";
import type { LocationAnalytics, MerchantSpend, SpendFigures } from "@/lib/merchant-analytics";
import { daysBetween, greeting, headline, localNow, quietDays } from "@/lib/overview-day";
import type { LaunchReadiness } from "@/lib/readiness";
import type { RetentionSummary } from "@/lib/retention";
import { retentionCustomerHref } from "@/lib/retention-links";
import { formatMinor } from "@/lib/spend-copy";
import { CancellationNotice } from "./cancellation-notice";
import { downloadCounterSign, JoinCard, joinUrlOf } from "./join-card";
import { BigMoney, Board, BoardPlaceholder, CardStock, Diary, EmptyStrip, Milestone, NextBar, Strip, Tiles, type NextAction, type Tile } from "./overview-board";
import { buildInsights, type ReferralRow, type WinbackState } from "./retention-insights";
import { useOwner } from "./owner-context";
import { nf } from "./owner-ui";
import { useLoad, type Loadable } from "./use-load";

/*
 * The Übersicht, direction D (ENG-085, founder 24 Oct; Design's spec v2, Marketing's copy of 24 Oct): one green board,
 * four tiles for the last 30 days at the active location, the next step, the diary. Everything is about the active location.
 */

const unitOf = (me: MeResponse) => me.programType === "points" ? "Punkte" : "Stempel";
const NBSP = "\u00a0";
const STRIP_CAPTION = "Buchungen an diesem Standort · letzte 7 Tage";
const OFFLINE_LINE = "Lädt, sobald die Verbindung wieder da ist.";
/** Q-81 (founder, open): false = a shop without till amounts leads with bookings; true = it shows the „geschätzt“ estimate or asks for the average. */
const ESTIMATES_ON_BOARD = false;
const AVERAGE_HREF = "/merchant/program";
const ASK_KEY = "loynara:average-ask-hidden-until";
const MILESTONES = [100, 50, 25, 10, 1];
const MILESTONE_KEY = "loynara:milestones-seen";
// Steps Loynara cannot check (NFC acceptance) or that do not apply are never ticked, only named (readiness.ts).
const STEP_STATUS: Record<LaunchReadiness["steps"][number]["status"], string> = { done: "erledigt", todo: "offen", external: "außerhalb von Loynara", not_applicable: "nicht nötig" };

/** The signed-in person's first name, if the account has one (never the shop's name). */
function useFirstName(): string {
  const [session] = useLoad<{ user?: { name?: string | null } } | null>("/api/auth/get-session");
  const name = session.state === "ok" ? session.data?.user?.name?.trim() ?? "" : "";
  return name.includes("@") ? "" : name.split(/\s+/)[0] ?? "";
}

const onStorage = (notify: () => void) => { window.addEventListener("storage", notify); return () => window.removeEventListener("storage", notify); };
const readStorage = (key: string) => () => { try { return window.localStorage.getItem(key); } catch { return null; } };

export function Overview() {
  const owner = useOwner();
  const me = owner.me as MeResponse;
  // Until the first booking at this location, the board guides the set-up (spec §2.4).
  return (me.stats?.awards ?? 0) === 0 ? <EmptyShop me={me} /> : <ActiveBusiness me={me} />;
}

/**
 * Days without a booking for the quiet-week rules (7+), or "over90" when the read's 90 days hold none although the
 * programme ran longer (CTO option B). A programme younger than that with no booking left (say, one corrected) is not quiet.
 */
export function quietOf(a: Pick<LocationAnalytics, "lastBookingOn" | "programStartedOn" | "today">): number | "over90" | null {
  if (a.lastBookingOn) return quietDays(a.lastBookingOn, a.today);
  return a.programStartedOn && daysBetween(a.programStartedOn, a.today) > 90 ? "over90" : null;
}

/* ───────────── Active business ───────────── */

function ActiveBusiness({ me }: { me: MeResponse }) {
  const { locations, hiddenSurfaces } = useOwner();
  const isOwner = me.role === "owner";
  const [analytics, reloadAnalytics] = useLoad<LocationAnalytics>(`/api/merchant/analytics/location?locationId=${encodeURIComponent(me.locationId)}`);
  // Euros are owner-only (the spend read refuses everyone else); the Leitung's board leads with their card stock.
  const [spend, reloadSpend] = useLoad<MerchantSpend>(isOwner ? "/api/merchant/spend" : null);
  const [retention, reloadRetention] = useLoad<RetentionSummary>(`/api/merchant/retention?days=30&locationId=${encodeURIComponent(me.locationId)}`);
  const [referrals] = useLoad<{ referrals: ReferralRow[] }>(isOwner ? `/api/merchant/referrals?programSlug=${encodeURIComponent(me.programSlug)}` : null);
  const [readiness] = useLoad<LaunchReadiness>("/api/merchant/readiness");
  const firstName = useFirstName();
  const [signError, setSignError] = useState("");

  const failed = [analytics, spend, retention].some(state => state.state === "error");
  const reload = () => { reloadAnalytics(); reloadSpend(); reloadRetention(); };
  const a = analytics.state === "ok" ? analytics.data : null;
  const r = retention.state === "ok" ? retention.data : null;
  const live = a && (isOwner ? spend.state === "ok" : r) ? boardOf(a, isOwner && spend.state === "ok" ? spend.data : null, r, me.locationId) : null;
  const cacheKey = boardCacheKey(me.userId, me.locationId);
  const liveJson = live ? JSON.stringify(live) : null;
  useEffect(() => { if (liveJson) writeBoardCache(cacheKey, { at: new Date().toISOString(), board: JSON.parse(liveJson) as BoardData }); }, [cacheKey, liveJson]);
  const cached = readBoardCache(useSyncExternalStore(onStorage, readStorage(cacheKey), () => null));
  // A failed read retries on its own when the page comes back into view or the connection returns.
  useEffect(() => {
    if (!failed) return;
    const retry = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", retry);
    window.addEventListener("online", retry);
    return () => { document.removeEventListener("visibilitychange", retry); window.removeEventListener("online", retry); };
  });

  // A failed read shows the last numbers this device loaded, with their „Stand …“; the error card only without them.
  const board = failed ? cached?.board ?? null : live;
  const timezone = board?.timezone ?? locations.find(location => location.id === me.locationId)?.timezone ?? "Europe/Berlin";
  const hello = `${greeting(localNow(new Date(), timezone).hour)}${firstName ? `, ${firstName}` : ""}.`;
  const quiet = a ? quietOf(a) : null;
  const news = board ? headline({ days: board.days, lastBookingOn: board.lastBookingOn, today: board.today, fullTwoWeeks: board.fullTwoWeeks, everBooked: board.over90 }) : null;
  const sign = () => { setSignError(""); downloadCounterSign(me).catch(cause => setSignError(cause instanceof Error ? cause.message : "Das Tresenschild konnte nicht geladen werden.")); };
  const next = failed ? null : nextStep({ me, retention, referrals: referrals.state === "ok" ? referrals.data.referrals : null, readiness, winback: a?.winback ?? null, quiet, sign });
  const milestone = useMilestone(me.locationId, me.stats?.members ?? 0);

  return (
    <div className="ow-page ow-dash" data-next={next ? "" : undefined}>
      <h1 className="ow-sr">Übersicht</h1>
      <div className="ow-dash-notice ow-stack"><CancellationNotice me={me} />{milestone !== null && <Milestone cards={milestone} action={sign} />}</div>
      {failed && !board ? <ErrorCard reload={reload} />
        : <Board hello={hello} kicker={!isOwner ? "Karten an deinem Standort · 30 Tage" : !board?.spend || boardEuros(board.spend.figures) ? "Umsatz deiner Loynara-Kunden · 30 Tage" : "Buchungen · letzte 30 Tage"} busy={!board}>
          {!board ? <BoardPlaceholder /> : <>
            {board.spend ? <OwnerNumber spend={board.spend} bookings={board.bookings} /> : board.stock && <>
              <p className="ow-board-big">{nf.format(board.stock.recent)}{NBSP}<small>von {nf.format(board.stock.openCards)}</small></p>
              <p className="ow-board-sub">Karten mit Buchung in den letzten 30 Tagen</p>
              <CardStock recent={board.stock.recent} drifting={board.stock.drifting} never={board.stock.never} />
            </>}
            <Strip days={board.days} caption={STRIP_CAPTION} />
            {news && <p className="ow-board-news">{news}</p>}
            {failed && cached && <p className="ow-strip-cap" role="status">{standLabel(cached.at, new Date(), timezone)}</p>}
          </>}
        </Board>}
      <div className="ow-dash-side">
        {failed ? <p className="ow-muted">{OFFLINE_LINE}</p>
          : a && <Tiles tiles={tilesOf(a, { owner: isOwner, stats: me.stats, seenKey: seenCardsKey(me.userId, me.locationId), bookingsHref: r ? retentionCustomerHref(r, "recent") : null, bonusHref: hiddenSurfaces.includes("walletMessages") ? null : "/merchant/wallet-messages#winback-title" })} />}
        {next && <NextBar {...next} />}
        {signError && <p className="ow-error" role="alert">{signError}</p>}
      </div>
      <Diary diary={failed ? [] : a?.diary ?? []} today={a?.today ?? ""} unit={unitOf(me)} gap={!failed && typeof quiet === "number" && a?.lastBookingOn ? { from: shiftDay(a.lastBookingOn, 1), to: shiftDay(a.today, -1) } : null}>
        {failed ? <p className="ow-muted">{OFFLINE_LINE}</p> : !a ? <p className="ow-muted" aria-busy="true">Lädt …</p> : null}
      </Diary>
      {/* Until ENG-086 moves them under Kunden, the invite link and the Tresenschild stay reachable here, below the diary
          (Einstellungen, where the owner also finds them, is owner-only). */}
      <div className="ow-dash-invite"><JoinCard me={me} /></div>
    </div>
  );
}

/** The board's numbers, the only part of the page kept on this device (board-cache.ts). */
export function boardOf(a: LocationAnalytics, spend: MerchantSpend | null, r: RetentionSummary | null, locationId: string): BoardData {
  return {
    timezone: a.timezone, today: a.today, days: a.days, lastBookingOn: a.lastBookingOn, fullTwoWeeks: a.fullTwoWeeks, over90: quietOf(a) === "over90", bookings: a.current.qualifyingCheckouts,
    spend: spend ? { currency: spend.currency, figures: locationSpend(spend, locationId) } : undefined,
    stock: !spend && r ? { recent: r.recent, openCards: r.openCards, drifting: r.drifting, never: r.never } : undefined,
  };
}

const shiftDay = (date: string, by: number) => new Date(new Date(`${date}T12:00:00Z`).getTime() + by * 86_400_000).toISOString().slice(0, 10);

/** The active location's 30 days in the spend read (the board is about this location, spec §1). */
const locationSpend = (spend: MerchantSpend, locationId: string): SpendFigures => spend.locations.find(row => row.locationId === locationId)?.recent ?? spend.overall.recent;
/** Euros lead when bookings carried till amounts; an average-only estimate leads only behind the Q-81 switch. */
const boardEuros = (f: SpendFigures) => f.realMinor > 0 || (ESTIMATES_ON_BOARD && f.averagePerVisitMinor !== null);

function OwnerNumber({ spend, bookings }: { spend: NonNullable<BoardData["spend"]>; bookings: number }) {
  const f = spend.figures;
  const [askHidden, hideAsk] = useHiddenAsk();
  if (boardEuros(f)) {
    const exact = f.estimatedMinor === 0;
    return <>
      <BigMoney text={formatMinor(f.spentMinor, spend.currency)} />
      <p className="ow-board-sub">{exact ? "aus Kassenbeträgen an diesem Standort" : f.realMinor === 0 ? "geschätzt aus Buchungen × Durchschnittsbon" : "teilweise geschätzt"}</p>
      <details className="ow-board-why"><summary aria-label="So zählen wir den Umsatz">?</summary><p>{exact ? "Summe der Kassenbeträge, die dein Team bei Loynara-Buchungen eingegeben hat. Bonuspunkte zählen nicht." : "Buchungen × dein Durchschnittsbon. Darum steht „geschätzt“ dabei."}</p></details>
    </>;
  }
  return <>
    <p className="ow-board-big">{nf.format(bookings)}{NBSP}<small>{bookings === 1 ? "Buchung" : "Buchungen"}</small></p>
    <p className="ow-board-sub">bestätigt an der Kasse</p>
    {ESTIMATES_ON_BOARD && f.averagePerVisitMinor === null && !askHidden && <div className="ow-board-ask">
      <p>Für den Umsatz deiner Loynara-Kunden fehlt nur dein Durchschnittsbon.</p>
      <div className="ow-board-actions"><Link className="ow-btn ow-btn--board ow-btn--sm" href={AVERAGE_HREF}>Durchschnittsbon eintragen</Link><button type="button" className="ow-board-textbtn" onClick={hideAsk}>Nicht jetzt</button></div>
    </div>}
  </>;
}

const readAskHidden = () => { try { return Number(window.localStorage.getItem(ASK_KEY) ?? 0) > Date.now(); } catch { return false; } };
const readMilestones = () => { try { return window.localStorage.getItem(MILESTONE_KEY) ?? ""; } catch { return "-"; } };

/** „Nicht jetzt“ hides the average ask for 30 days in this browser (spec §2.2); without storage the ask simply stays. */
function useHiddenAsk(): [boolean, () => void] {
  const stored = useSyncExternalStore(onStorage, readAskHidden, () => false);
  const [dismissed, setDismissed] = useState(false);
  return [stored || dismissed, () => {
    setDismissed(true);
    try { window.localStorage.setItem(ASK_KEY, String(Date.now() + 30 * 86_400_000)); } catch { /* storage blocked: hidden until reload */ }
  }];
}

/**
 * The highest card milestone the location reached that this browser has not shown (`seen`: the stored list); null
 * without storage ("-": server render or blocked storage), so the card can never repeat on every visit.
 */
export function milestoneToShow(cards: number, seen: string, locationId: string): number | null {
  const reached = MILESTONES.find(milestone => cards >= milestone) ?? null;
  return reached !== null && seen !== "-" && !seen.split(",").includes(`${locationId}:${reached}`) ? reached : null;
}

/** The milestone to show now, marked as shown once it is on screen (spec §6.3; v1 keeps it in this browser). */
function useMilestone(locationId: string, cards: number): number | null {
  const seen = useSyncExternalStore(onStorage, readMilestones, () => "-");
  const show = milestoneToShow(cards, seen, locationId);
  useEffect(() => {
    if (show === null) return;
    try { window.localStorage.setItem(MILESTONE_KEY, [...seen.split(",").filter(Boolean), `${locationId}:${show}`].join(",")); } catch { /* shown this once anyway */ }
  }, [show, seen, locationId]);
  return show;
}

/**
 * The four tiles (spec §1.3, copy T0–T6, Q1–Q4). A tile whose event never happened at this location shows „–“ and when it
 * will appear (lifetime counts from /api/me); a real 0 after earlier activity stays 0. The page only shows after the first
 * booking, so the Buchungen tile always has a number. Notes: „erste/zweite Woche“ in the programme's first 14 days,
 * „vorher N“ once there is a full previous period (O7), else what was counted. Only the Buchungen tile links to a Kunden
 * filter that exists today; the others come with ENG-086.
 */
export function tilesOf(a: LocationAnalytics, options: { owner: boolean; stats?: MeResponse["stats"]; seenKey?: string; bookingsHref: string | null; bonusHref: string | null }): Tile[] {
  const sinceStart = a.programStartedOn ? daysBetween(a.programStartedOn, a.today) : null;
  const note = (key: "qualifyingCheckouts" | "newCards" | "winbacks" | "redemptions", plain: string) =>
    sinceStart !== null && sinceStart < 7 ? "erste Woche" : sinceStart !== null && sinceStart < 14 ? "zweite Woche" : a.previous ? `vorher ${nf.format(a.previous[key])}` : plain;
  const bonusOn = a.winbackSetting?.enabled ?? false;
  const bonusOff = options.owner && options.bonusHref ? <Link className="ow-link" href={options.bonusHref}>Willkommen-zurück-Bonus ist aus</Link> : "Willkommen-zurück-Bonus ist aus";
  const noCards = options.stats?.members === 0, noRewards = options.stats?.redemptions === 0;
  return [
    { key: "bookings", label: "Buchungen", value: nf.format(a.current.qualifyingCheckouts), note: note("qualifyingCheckouts", "an der Kasse bestätigt"), help: "Jede bestätigte Buchung an der Kasse, Korrekturen abgezogen.", href: options.bookingsHref ?? undefined },
    { key: "cards", label: "Neue Karten", value: noCards ? "–" : nf.format(a.current.newCards), note: noCards ? "erscheint mit der ersten Anmeldung" : note("newCards", "erstmals angemeldet"), ...(noCards ? {} : { count: a.current.newCards, seenKey: options.seenKey }), help: "Karten, die sich in diesem Zeitraum zum ersten Mal angemeldet haben." },
    { key: "back", label: "Wiedergekommen", value: bonusOn ? nf.format(a.current.winbacks) : "–", note: bonusOn ? note("winbacks", "mit Willkommen-zurück-Bonus") : bonusOff,
      help: `Karten, die nach über ${a.winbackSetting?.days ?? 30} Tagen wiederkamen und den Willkommen-zurück-Bonus bekamen.` },
    { key: "rewards", label: "Prämien eingelöst", value: noRewards ? "–" : nf.format(a.current.redemptions), note: noRewards ? "erscheint nach der ersten Einlösung" : note("redemptions", "an der Kasse"), help: "Prämien, die dein Team an der Kasse eingelöst hat." },
  ];
}

const cardsText = (n: number, one: string, many: string) => n === 1 ? `1${NBSP}Karte ${one}` : `${nf.format(n)}${NBSP}Karten ${many}`;

/**
 * „Als Nächstes“: one line, one verb (copy N1–N3), status by exception. A quiet week (7+ days without a booking) first,
 * then an open required set-up step, then the most urgent observation. Nothing urgent: no bar. While the programme is
 * ending, the end-date card leads instead.
 */
export function nextStep(input: { me: MeResponse; retention: Loadable<RetentionSummary>; referrals: ReferralRow[] | null; readiness: Loadable<LaunchReadiness>; winback: WinbackState; quiet: number | "over90" | null; sign: () => void }): { title: string; text?: string; action?: NextAction } | null {
  const { me, retention, referrals, readiness, winback, quiet, sign } = input;
  const isOwner = me.role === "owner";
  if (me.cancellationEndDate) return null;
  if (quiet !== null) return { title: `${quiet === "over90" ? "Seit über 90 Tagen" : `Seit ${quiet} Tagen`} keine Buchung. Steht das Tresenschild noch gut sichtbar?`, action: { label: "Tresenschild laden", onClick: sign } };
  if (retention.state !== "ok" || readiness.state !== "ok") return null;
  // The step's evidence is its action sentence (#129); its title stays on the steps list.
  const setup = readiness.data.steps.find(step => step.required && step.status === "todo" && step.action && (isOwner || !step.action.ownerOnly));
  if (setup) return { title: setup.evidence, action: setup.action ?? undefined };
  const insight = buildInsights({ summary: retention.data, unit: unitOf(me), isOwner, campaigns: !(me.hiddenSurfaces ?? []).includes("campaigns"), referrals, winback })[0];
  const s = retention.data;
  if (insight?.id === "drifting") {
    const last = insight.actions.at(-1)!;
    return { title: cardsText(s.drifting, "fehlt seit über 30 Tagen.", "fehlen seit über 30 Tagen."), text: insight.next, action: last.href.startsWith("/merchant/wallet-messages") ? last : { label: "Ansehen", href: last.href } };
  }
  if (insight?.id === "reward-ready") return { title: cardsText(s.rewardReady, "kann jetzt eine Prämie einlösen.", "können jetzt eine Prämie einlösen."), action: { label: "Ansehen", href: insight.actions[0].href } };
  if (insight) return { title: `${insight.title}.`, text: insight.next, action: insight.actions.at(-1) };
  return null;
}

function ErrorCard({ reload }: { reload: () => void }) {
  return (
    <section className="ow-card ow-stack ow-dash-error" role="alert">
      <h2>Die Zahlen sind gerade nicht da.</h2>
      <p>Die Verbindung zu Loynara hat nicht geklappt.</p>
      <div><button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={reload}>Erneut laden</button></div>
    </section>
  );
}

/* ───────────── Empty shop: the board guides the first required step ───────────── */

/** The rail's steps and their sentences (copy E7). Karte gestalten and Team stay where they are today (Programm, Team). */
const FIRST_STEPS: Record<string, (me: MeResponse) => { title: string; text?: string }> = {
  programme: () => ({ title: "Programm und Prämie" }),
  enrolment: () => ({ title: "Erste Karte anmelden", text: "Mit dem Anmeldelink oder dem Tresenschild." }),
  first_award: me => ({ title: "Erste Buchung an der Kasse", text: me.programType === "points" ? "Ein paar Punkte auf deine eigene Karte." : "Ein Stempel auf deine eigene Karte." }),
  first_redemption: () => ({ title: "Einlösung einmal durchspielen", text: "Zeigt deinem Team die Bestätigung." }),
};

function EmptyShop({ me }: { me: MeResponse }) {
  const [readiness, reloadReadiness] = useLoad<LaunchReadiness>("/api/merchant/readiness");
  const today = localNow(new Date(), "Europe/Berlin").date;
  const steps = readiness.state === "ok" ? readiness.data.steps.filter(step => step.id in FIRST_STEPS) : [];
  const current = steps.find(step => step.required && step.status === "todo");
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
        {readiness.state === "error" ? <div className="ow-board-ask"><p>Die Zahlen sind gerade nicht da.</p><div><button type="button" className="ow-btn ow-btn--board ow-btn--sm" onClick={reloadReadiness}>Erneut laden</button></div></div>
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
        {steps.map(step => {
          const copy = FIRST_STEPS[step.id](me);
          return (
            <div className="ow-day" key={step.id} data-state={step.status === "done" ? undefined : step === current ? "current" : "open"}>
              <div className="ow-day-rail" aria-hidden="true"><i /><span /></div>
              <div>
                <h3>{copy.title}{step.required && step.status !== "done" && <span className="ow-chip" style={{ marginLeft: 8 }}>Pflicht</span>}<span className="ow-sr"> ({STEP_STATUS[step.status]})</span></h3>
                <p className="ow-day-sum">{step.status === "done" || !copy.text ? step.evidence : copy.text}</p>
              </div>
            </div>
          );
        })}
      </section>
      {/* The invite link and the Tresenschild, until ENG-086 moves them under Kunden. */}
      <JoinCard me={me} />
    </div>
  );
}
