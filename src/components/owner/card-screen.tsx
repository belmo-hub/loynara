"use client";

import Link from "next/link";
import { Check, ChevronLeft, ChevronRight, Gift, Hourglass, Link2, Undo2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { apiJson, type PublicProgram } from "@/components/client-api";
import { cardGoal, nearestReward } from "@/components/customer/card-face";
import { MixCard, progressLine } from "@/components/customer/mix-card";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/empty-state";
import { NumberRoll } from "@/components/ui/number-roll";
import { merchantPalette } from "@/components/ui/merchant-color";
import { MixChip, MixPanel, mixStyles, MixTile } from "@/components/ui/mix";
import type { MerchantMember, MerchantMemberDetail } from "@/lib/merchant-members";
import { unitWord, withUnit } from "@/lib/units";
import { correctable, CorrectionStep, ReissueStep, sourceLabel } from "./card-actions";
import { useOwner } from "./owner-context";
import { BERLIN, daysBetween, shopZone, zoneDay } from "@/lib/german-date";
import { ErrorNotice, germanDate, nf, Notice } from "./owner-ui";
import { useReview } from "./question-form";
import { useLoad } from "./use-load";
import s from "./card-screen.module.css";

type Entry = MerchantMemberDetail["timeline"][number];
const NBSP = " ";

const when = (value: string | null, timeZone: string) => value ? germanDate(value, "feed", { timeZone }) : "Noch kein bestätigter Vorgang";
function eligibilityLabel(value: MerchantMember["eligibility"]) {
  return ({ eligible: "Prämie einlösbar", not_yet: "Noch nicht einlösbar", not_configured: "Keine aktive Prämie", closed: "Karte geschlossen", not_checked: "Noch nicht geprüft", unavailable: "Nicht verfügbar" } as const)[value];
}
function referralLabel(value: MerchantMember["referralStatus"]) {
  return ({ none: "Keine Zuordnung", pending: "Wartet auf den ersten bestätigten Vorgang", qualified: "Bonus gutgeschrieben", review: "In Prüfung", rejected: "Abgelehnt", reversed: "Nach Korrektur zurückgenommen" } as const)[value];
}

/**
 * Kunden 03 (ENG-122a), in the founder's mix (ENG-258, D's Kartenseite): the mix card with the owner's line, the three
 * figures, „Verlauf“ grouped by day with „Korrigieren“ per entry, „Details“, then „Karte neu ausstellen“. Correcting (04) and reissuing (05/06) are steps in
 * this page's history (useReview), so Back returns to the card. `onMember` tells the list what the card read says now.
 */
export function CardScreen({ id, seed: given, back, onMember }: { id: string; seed?: { member: MerchantMember; program: PublicProgram }; back: Back; onMember: (member: MerchantMember) => void }) {
  const me = useOwner().me!;
  const zone = shopZone(useOwner());
  const [first, reload] = useLoad<MerchantMemberDetail>(`/api/merchant/customers/${encodeURIComponent(id)}`);
  // The target reward comes from the active location's programme: the card read lists only the rewards already reached.
  const [program] = useLoad<PublicProgram>(`/api/program/${encodeURIComponent(me.programSlug)}`);
  const [older, setOlder] = useState<{ timeline: Entry[]; next: string | null } | null>(null);
  const [olderBusy, setOlderBusy] = useState(false);
  const [olderError, setOlderError] = useState("");
  const [notice, setNotice] = useState("");
  const { step, open, back: stepBack } = useReview<string>();
  const box = useRef<HTMLDivElement>(null), y = useRef(0);
  const detail = first.state === "ok" ? first.data : null, loaded = detail !== null;
  // Opened from its row, a points card's fill grows once the card has landed (ENG-299); a step's return does not grow it again.
  // The row's data, only for the mount a tap made (customers-view): kept, so a later render of this mount cannot drop it.
  const [seed] = useState(given);
  const [grow, setGrow] = useState(Boolean(seed));
  useEffect(() => { if (detail) onMember(detail.member); }, [detail, onMember]);
  // A step or the card comes in at the top with its heading focused; back on the card, where it was left (or at the notice).
  useLayoutEffect(() => {
    window.scrollTo({ top: step ? 0 : y.current, behavior: "instant" }); // the page scrolls smoothly elsewhere; a new screen jumps
    box.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }, [step, loaded]);

  // A failed read shows no title placeholder; a card that is not there (404) gets no retry, which could not find it.
  if (first.state === "error") return <div ref={box} className="ow-page"><Head back={back} title={null} /><div className={s.alert}><ErrorNotice message={first.message} onRetry={first.status === 404 ? undefined : reload} /></div></div>;
  // From its row the card is there in the navigation's own commit, painted from the row; only the rest waits for the read.
  if (!detail && !seed) return <div ref={box} className="ow-page"><Head back={back} /><CardLoading /></div>;

  const member = detail?.member ?? seed!.member, kind = member.programType;
  const programData = program.state === "ok" ? program.data : seed?.program;
  const timeline = [...detail?.timeline ?? [], ...older?.timeline ?? []];
  const nextCursor = older ? older.next : detail?.nextCursor ?? null;
  // Corrections and reissues run against the active location (the server checks the same); elsewhere only explain.
  const canAct = member.locationId === me.locationId && !member.closedAt;
  const openStep = (next: string) => { y.current = window.scrollY; setNotice(""); setGrow(false); open(next); };
  const done = (text: string) => { setNotice(text); setOlder(null); reload(); y.current = 0; };
  const stepBackTo = { label: member.cardLocator, onClick: stepBack };
  const correcting = step?.startsWith("correct:") ? timeline.find(entry => entry.id === step.slice(8)) : undefined;
  if (canAct && step === "reissue") return <div ref={box}><ReissueStep membershipId={member.id} cardLocator={member.cardLocator} back={stepBackTo} onIssued={() => done("Karte neu ausgestellt. Der alte Link ist ungültig.")} /></div>;
  if (canAct && correcting && correctable(correcting)) return <div ref={box}><CorrectionStep entry={correcting} kind={kind} locationId={me.locationId} balance={member.balance} back={stepBackTo}
    onDone={() => { done("Korrektur gebucht. Der Kontostand und der Verlauf sind aktualisiert."); stepBack(); }} /></div>;

  const target = !member.closedAt && member.locationId === me.locationId && programData ? nearestReward(programData.rewards, member.balance) : undefined;
  // The mix card counts to the next reward not reached yet, as the guest's card and the Kasse do (Design, #285 b).
  const rewards = programData?.rewards ?? [], mixTarget = target && cardGoal(rewards, member.balance);
  async function loadOlder() {
    if (!nextCursor || olderBusy) return;
    setOlderBusy(true); setOlderError("");
    try {
      const page = await apiJson<MerchantMemberDetail>(`/api/merchant/customers/${encodeURIComponent(id)}?cursor=${encodeURIComponent(nextCursor)}`);
      setOlder(current => ({ timeline: [...current?.timeline ?? [], ...page.timeline], next: page.nextCursor }));
    } catch (cause) { setOlderError(cause instanceof Error ? cause.message : "Die Daten konnten nicht geladen werden."); }
    finally { setOlderBusy(false); }
  }
  const days = timeline.reduce<Array<[string, Entry[]]>>((list, entry) => {
    const day = dayLabel(entry.createdAt, new Date(), zone), last = list.at(-1);
    if (last?.[0] === day) last[1].push(entry); else list.push([day, [entry]]);
    return list;
  }, []);
  const details: Array<[string, string | number]> = !detail ? [] : [
    ["Prämienstatus", eligibilityLabel(member.eligibility)],
    ...detail.eligibleRewards.length > 0 ? [["Jetzt einlösbar", detail.eligibleRewards.map(reward => `${reward.title} · ${withUnit(reward.cost, kind)}`).join(", ")] as [string, string]] : [],
    ["Erste Buchung", when(member.firstQualifyingAt, zone)],
    ["Erfasste Käufe", member.purchaseCount === null ? "Nicht erfasst" : member.purchaseCount],
    ["E-Mail-Marketing", member.emailMarketingEligible ? "Verifiziert und zugestimmt" : "Nicht berechtigt"],
    ["Als geworbene Karte", referralLabel(member.referralStatus)],
    ["Erfolgreich geworben", member.qualifiedReferrals],
  ];

  return (
    <div ref={box} className="ow-page">
      <Head back={back} title={member.cardLocator} closed={Boolean(member.closedAt)} />
      {notice && <Notice tone="ok" role="status">{notice}</Notice>}
      <div className={s.layout} aria-busy={!detail || undefined}>
        {mixTarget && programData
          ? <div className={s.card} data-card-face="" style={merchantPalette(programData.brandColor ?? "", "light").cssVars as CSSProperties}>
            <MixCard businessName={programData.businessName} locationName={programData.locationName} programType={kind === "points" ? "points" : "stamps"}
              balance={member.balance} reward={mixTarget} rewards={rewards} lineReward={target} voice="owner" grow={grow && kind === "points"} />
          </div>
          // A card without a target (no reward set up, closed, another location) keeps the house balance block.
          : <section className={cx("ow-board ow-stand", s.card)} aria-labelledby="cu-stand">
            <p className="ow-board-kicker" id="cu-stand">Aktueller Stand</p>
            <p className="ow-board-big"><NumberRoll value={member.balance}>{nf.format(member.balance)}</NumberRoll>{NBSP}<small>{unitWord(member.balance, kind)}</small></p>
            {target && <p className="ow-board-news">{progressLine(member.balance, target, kind)}</p>}
          </section>}
        {!detail ? <CardRest /> : <>
        <MixPanel pad className={s.facts}>
          <Fact value={nf.format(member.qualifyingCheckouts)} label={member.qualifyingCheckouts === 1 ? "Buchung" : "Buchungen"} />
          <Fact value={nf.format(member.redemptionCount)} label={member.redemptionCount === 1 ? "Einlösung" : "Einlösungen"} />
          <Fact value={sinceDate(member.createdAt, zone)} label="Karte seit" />
        </MixPanel>
        <section className={cx(mixStyles.panel, s.feed)} aria-labelledby="cu-verlauf">
          <div className={mixStyles.ph}><h2 className={mixStyles.h} id="cu-verlauf">Verlauf</h2></div>
          {timeline.length === 0 ? <EmptyState level={3} size="compact" className={s.empty} title="Noch keine Buchungen.">Buchungen und Einlösungen dieser Karte erscheinen hier.</EmptyState>
            : days.map(([day, entries]) => <div key={day} role="group" aria-label={day}>
              <p className={s.day} aria-hidden="true">{day}</p>
              {entries.map(entry => <Statement key={entry.id} entry={entry} kind={kind} timeline={timeline} zone={zone}
                onCorrect={canAct && correctable(entry) ? () => openStep(`correct:${entry.id}`) : undefined} />)}
            </div>)}
          {olderError && <div className={s.olderError}><ErrorNotice message={olderError} onRetry={() => void loadOlder()} /></div>}
          {nextCursor && <button type="button" className={cx(mixStyles.more, s.more)} onClick={() => void loadOlder()} disabled={olderBusy}>{olderBusy ? "Wird geladen …" : "Ältere Vorgänge laden"}</button>}
        </section>
        <MixPanel className={s.details} head={<h2 className={mixStyles.h}>Details</h2>}>
          {details.map(([label, value]) => <div key={label} className={mixStyles.row}><div className={mixStyles.body}><span className={s.key}>{label}</span><span className={s.value}>{value}</span></div></div>)}
        </MixPanel>
        {!member.closedAt && (canAct
          ? <MixPanel className={s.action}><button type="button" className={cx(mixStyles.row, s.rowButton)} data-lead="tile" onClick={() => openStep("reissue")}>
            <MixTile><Link2 size={20} /></MixTile>
            <span className={mixStyles.body}><span className={mixStyles.text}><b>Karte neu ausstellen</b><small>Neuer Link bei verlorenem Kartenlink. <br className={s.wideBreak} />Der Stand bleibt.</small></span>
              <ChevronRight className={mixStyles.chev} size={20} aria-hidden="true" /></span>
          </button></MixPanel>
          : <MixPanel pad className={s.action}><p className={mixStyles.sub}>Korrigieren und neu ausstellen ist am Standort {member.locationName} möglich. Wechsle dazu den aktiven Standort.</p></MixPanel>)}
        </>}
      </div>
    </div>
  );
}

/** A flat placeholder of `width` × `height` with the house shimmer passing over it (still under reduced motion). */
const Bar = ({ width, height, className }: { width: number | string; height: number; className?: string }) =>
  <span className={cx("ow-ph", s.sk, s.bar, className)} style={{ width, height }} />;

/** While the card loads: the page's own shapes at each width (card, figures, „Verlauf“ with three lines), no Details yet. */
function CardLoading() {
  return <div className={s.layout} role="status" aria-label="Wird geladen" aria-busy="true">
    <div className={cx("ow-ph", s.sk, s.card, s.ghost)} aria-hidden="true" />
    <CardRest />
  </div>;
}

/** The figures and „Verlauf“ while they load; the card above them may already be painted from its row. */
function CardRest() {
  return <>
    <MixPanel pad className={s.facts}>
      {[[32, 72], [32, 64], [128, 64]].map(([figure, label], i) => <div key={i} aria-hidden="true"><Bar width={figure} height={20} /><span className={s.label}><Bar width={label} height={12} /></span></div>)}
    </MixPanel>
    <section className={cx(mixStyles.panel, s.feed)}>
      <div className={mixStyles.ph}><h2 className={mixStyles.h}>Verlauf</h2></div>
      {[0, 1, 2].map(i => <div key={i} className={mixStyles.row} data-lead="tile" aria-hidden="true">
        <span className={cx("ow-ph", s.sk, s.tileBar)} />
        <div className={mixStyles.body}><span className={mixStyles.text}><Bar width={96} height={16} /><Bar width={110} height={12} /></span><Bar width={40} height={16} className={s.amountBar} /></div>
      </div>)}
    </section>
  </>;
}

/** A figure over its label in the wide rail, a row with the label first up to 1199 (the phone since ENG-290). */
function Fact({ value, label }: { value: string; label: string }) {
  return <div><b className={s.figure}>{value}</b><span className={s.label}>{label}</span></div>;
}

const KIND = { award: "Gutschrift", redeem: "Einlösung", expiry: "Verfallen", reversal: "Korrektur" } as const;
const time = (at: string, timeZone: string) => new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(at));
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "\u2212" : ""}${nf.format(Math.abs(n))}`;

/**
 * One statement line (D): tile, what happened, its time and source, the amount at the right with „Korrigieren“ under it
 * (beside it from 600). A correction hangs from its first line and says what it undoes and why.
 */
function Statement({ entry, kind, timeline, zone, onCorrect }: { entry: Entry; kind: MerchantMember["programType"]; timeline: Entry[]; zone: string; onCorrect?: () => void }) {
  const reversal = entry.kind === "reversal", redeem = entry.kind === "redeem";
  const original = reversal && entry.reversalOfId ? timeline.find(item => item.id === entry.reversalOfId) : undefined;
  const subs = reversal
    ? [time(entry.createdAt, zone), entry.reversalOfId ? (original ? `Hebt die ${KIND[original.kind]} vom ${germanDate(original.createdAt, "feed", { timeZone: zone })} auf.` : "Hebt einen älteren Vorgang auf.") : null, entry.reason ? `Grund: ${entry.reason}` : null]
    : [`${time(entry.createdAt, zone)} · ${sourceLabel(entry.source)}`];
  const tone = redeem ? "coral" : reversal || entry.kind === "expiry" || entry.reversed ? "mute" : undefined;
  const Icon = redeem ? Gift : reversal ? Undo2 : entry.kind === "expiry" ? Hourglass : Check;
  return <div className={cx(mixStyles.row, s.stmt)} data-lead="tile" data-entry={entry.kind} data-hang={reversal || undefined}>
    <MixTile tone={tone}><Icon size={20} /></MixTile>
    <div className={cx(mixStyles.body, s.stmtBody)}>
      <b className={s.title}>{redeem ? entry.rewardTitle ?? KIND.redeem : KIND[entry.kind]}
        {redeem && entry.rewardTitle ? <MixChip>{KIND.redeem}</MixChip> : entry.reversed ? <MixChip>Korrigiert</MixChip> : null}</b>
      {subs.filter(Boolean).map(line => <small key={line} className={s.sub}>{line}</small>)}
      <span className={s.end}>
        <span className={s.amount} data-tone={entry.reversed ? "off" : entry.delta > 0 ? "plus" : undefined}>{signed(entry.delta)}<span className="ow-sr"> {unitWord(entry.delta, kind)}</span></span>
        {onCorrect && <button type="button" className={s.correct} onClick={onCorrect}>Korrigieren</button>}
      </span>
    </div>
  </div>;
}

const sinceDate = (at: string, timeZone: string) => new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric", timeZone }).format(new Date(at));
/** The statement's day: „Heute“, „Gestern“ or „Donnerstag, 12.11.“, on the shop's clock (time-zone rule, 22 Nov). */
export function dayLabel(at: string, today = new Date(), timeZone = BERLIN) {
  const days = daysBetween(zoneDay(at, timeZone), zoneDay(today, timeZone));
  if (days === 0) return "Heute";
  if (days === 1) return "Gestern";
  return new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", timeZone }).format(new Date(at));
}

/** Back to the list the card came from, and the card number as the heading (a placeholder while it loads). */
type Back = { href: string; label: string; onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void };
function Head({ back, title, closed = false }: { back: Back; title?: string | null; closed?: boolean }) {
  return <header className="ow-pagehead"><div className="ow-qhead">
    <Link href={back.href} scroll={false} className="ow-back" onClick={back.onClick}><ChevronLeft size={20} aria-hidden="true" />{back.label}</Link>
    {title ? <h1 tabIndex={-1} className={s.cardNumber}>{title}</h1> : title === null ? null : <Bar width={200} height={34} className={s.titleBar} />}
    {closed && <span className="ow-chip">Geschlossen</span>}
  </div></header>;
}
