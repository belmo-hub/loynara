"use client";

import Link from "next/link";
import { ArrowRight, ChevronLeft, Gift, Link2, Plus, ReceiptText, RefreshCw, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { apiJson, type PublicProgram } from "@/components/client-api";
import { nearestReward } from "@/components/customer/card-face";
import { EmptyState } from "@/components/ui/empty-state";
import { NumberRoll } from "@/components/ui/number-roll";
import { STAMP_GRID_MAX, StampGrid } from "@/components/ui/stamp-grid";
import type { MerchantMember, MerchantMemberDetail } from "@/lib/merchant-members";
import { unitWord, withUnit } from "@/lib/units";
import { correctable, CorrectionStep, ReissueStep, sourceLabel } from "./card-actions";
import { useOwner } from "./owner-context";
import { ErrorNotice, germanDate, LoadingBlock, MoreInfo, nf, Notice, Skeleton } from "./owner-ui";
import { useReview } from "./question-form";
import { useLoad } from "./use-load";

type Entry = MerchantMemberDetail["timeline"][number];
const NBSP = " ";

const when = (value: string | null) => value ? germanDate(value, "feed") : "Noch kein bestätigter Vorgang";
function eligibilityLabel(value: MerchantMember["eligibility"]) {
  return ({ eligible: "Prämie einlösbar", not_yet: "Noch nicht einlösbar", not_configured: "Keine aktive Prämie", closed: "Karte geschlossen", not_checked: "Noch nicht geprüft", unavailable: "Nicht verfügbar" } as const)[value];
}
function referralLabel(value: MerchantMember["referralStatus"]) {
  return ({ none: "Keine Zuordnung", pending: "Wartet auf den ersten bestätigten Vorgang", qualified: "Bonus gutgeschrieben", review: "In Prüfung", rejected: "Abgelehnt", reversed: "Nach Korrektur zurückgenommen" } as const)[value];
}

/** R4: the line under the stamps, to the reward the guest's own card names (nearestReward), the title always in quotes. */
export function progressLine(balance: number, reward: { title: string; cost: number }, kind: "stamp" | "points") {
  const left = reward.cost - balance;
  return left <= 0 ? `Stand reicht für „${reward.title}“.` : `Noch ${nf.format(left)} ${unitWord(left, kind)} bis „${reward.title}“.`;
}

/** A fact as a row without an arrow: the label, its note, the value at the right edge. */
function Fact({ icon: Icon, label, sub, value, big = false }: { icon: LucideIcon; label: string; sub?: string; value: string; big?: boolean }) {
  return <li><div className="ow-prog-row">
    <span className="ow-prog-icon"><Icon size={22} aria-hidden="true" /></span>
    <span className="ow-prog-main">
      <span className="ow-prog-text"><strong>{label}</strong>{sub && <small>{sub}</small>}</span>
      <span className="ow-prog-value" data-big={big || undefined} data-off={!big || undefined}>{value}</span>
    </span>
  </div></li>;
}

/**
 * Kunden 03 (ENG-122a): one card. The balance card with the slots, the facts as rows, the Kartenverlauf in the Übersicht's
 * diary look with „Korrigieren“ per entry, then „Karte neu ausstellen“. Correcting (04) and reissuing (05/06) are steps in
 * this page's history (useReview), so Back returns to the card. `onMember` tells the list what the card read says now.
 */
export function CardScreen({ id, back, onMember }: { id: string; back: { href: string; label: string }; onMember: (member: MerchantMember) => void }) {
  const me = useOwner().me!;
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
  useEffect(() => { if (detail) onMember(detail.member); }, [detail, onMember]);
  // A step or the card comes in at the top with its heading focused; back on the card, where it was left (or at the notice).
  useLayoutEffect(() => {
    window.scrollTo({ top: step ? 0 : y.current, behavior: "instant" }); // the page scrolls smoothly elsewhere; a new screen jumps
    box.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }, [step, loaded]);

  if (first.state === "error") return <div ref={box} className="ow-page"><Head back={back} /><ErrorNotice message={first.message} onRetry={reload} /></div>;
  if (!detail) return <div ref={box} className="ow-page"><Head back={back} /><LoadingBlock rows={3} height={64} /></div>;

  const member = detail.member, kind = member.programType;
  const timeline = [...detail.timeline, ...older?.timeline ?? []];
  const nextCursor = older ? older.next : detail.nextCursor;
  // Corrections and reissues run against the active location (the server checks the same); elsewhere only explain.
  const canAct = member.locationId === me.locationId && !member.closedAt;
  const openStep = (next: string) => { y.current = window.scrollY; setNotice(""); open(next); };
  const done = (text: string) => { setNotice(text); setOlder(null); reload(); y.current = 0; };
  const stepBackTo = { label: member.cardLocator, onClick: stepBack };
  const correcting = step?.startsWith("correct:") ? timeline.find(entry => entry.id === step.slice(8)) : undefined;
  if (canAct && step === "reissue") return <div ref={box}><ReissueStep membershipId={member.id} cardLocator={member.cardLocator} back={stepBackTo} onIssued={() => done("Karte neu ausgestellt. Der alte Link ist ungültig.")} /></div>;
  if (canAct && correcting && correctable(correcting)) return <div ref={box}><CorrectionStep entry={correcting} kind={kind} locationId={me.locationId} balance={member.balance} back={stepBackTo}
    onDone={() => { done("Korrektur gebucht. Der Kontostand und der Verlauf sind aktualisiert."); stepBack(); }} /></div>;

  const target = !member.closedAt && member.locationId === me.locationId && program.state === "ok" ? nearestReward(program.data.rewards, member.balance) : undefined;
  const grid = target && kind === "stamp" && target.cost <= STAMP_GRID_MAX ? target : undefined;
  async function loadOlder() {
    if (!nextCursor || olderBusy) return;
    setOlderBusy(true); setOlderError("");
    try {
      const page = await apiJson<MerchantMemberDetail>(`/api/merchant/customers/${encodeURIComponent(id)}?cursor=${encodeURIComponent(nextCursor)}`);
      setOlder(current => ({ timeline: [...current?.timeline ?? [], ...page.timeline], next: page.nextCursor }));
    } catch (cause) { setOlderError(cause instanceof Error ? cause.message : "Die Daten konnten nicht geladen werden."); }
    finally { setOlderBusy(false); }
  }

  return (
    <div ref={box} className="ow-page">
      <Head back={back} title={member.cardLocator} closed={Boolean(member.closedAt)} />
      {notice && <Notice tone="ok" role="status">{notice}</Notice>}
      <div className="ow-prog">
        <section className="ow-board ow-stand" aria-labelledby="cu-stand">
          <p className="ow-board-kicker" id="cu-stand">Aktueller Stand</p>
          <p className="ow-board-big"><NumberRoll value={member.balance}>{nf.format(member.balance)}</NumberRoll>{NBSP}<small>{grid ? `von ${withUnit(grid.cost, kind, "de", "dat")}` : unitWord(member.balance, kind)}</small></p>
          {grid && <div className="ow-stand-grid"><StampGrid earned={member.balance} total={grid.cost} reward={<Gift size={22} />} /></div>}
          {target && <p className="ow-board-news">{progressLine(member.balance, target, kind)}</p>}
        </section>
        <ul>
          <Fact icon={ReceiptText} label="Bestätigte Buchungen" sub={`Zählt einmal, egal wie viele ${kind === "points" ? "Punkte" : "Stempel"}`} value={nf.format(member.qualifyingCheckouts)} big />
          <Fact icon={RefreshCw} label="Letzter Vorgang" value={when(member.lastQualifyingAt)} />
          <Fact icon={Plus} label="Erster Vorgang" value={when(member.firstQualifyingAt)} />
        </ul>
        <MoreInfo>
          <dl className="ow-dl">
            <dt>Erfasste Käufe</dt><dd>{member.purchaseCount === null ? "Nicht erfasst" : member.purchaseCount}</dd>
            <dt>Einlösungen</dt><dd>{member.redemptionCount}</dd>
            <dt>E-Mail-Marketing</dt><dd>{member.emailMarketingEligible ? "Verifiziert und zugestimmt" : "Nicht berechtigt"}</dd>
            <dt>Als geworbene Karte</dt><dd>{referralLabel(member.referralStatus)}</dd>
            <dt>Erfolgreich geworben</dt><dd>{member.qualifiedReferrals}</dd>
            <dt>Prämienstatus</dt><dd>{eligibilityLabel(member.eligibility)}</dd>
            {detail.eligibleRewards.length > 0 && <><dt>Jetzt einlösbar</dt><dd>{detail.eligibleRewards.map(reward => `${reward.title} · ${withUnit(reward.cost, kind)}`).join(", ")}</dd></>}
          </dl>
        </MoreInfo>
        <section className="ow-diary" aria-labelledby="cu-verlauf">
          <h2 id="cu-verlauf">Kartenverlauf</h2>
          {timeline.length === 0 ? <EmptyState level={3} size="compact" title="Noch keine Buchungen.">Buchungen und Einlösungen dieser Karte erscheinen hier.</EmptyState>
            : timeline.map(entry => {
              const original = entry.kind === "reversal" && entry.reversalOfId ? timeline.find(item => item.id === entry.reversalOfId) : undefined;
              return <div className="ow-day" key={entry.id}>
                <div className="ow-day-rail" aria-hidden="true"><i /><span /></div>
                <div>
                  <h3><time dateTime={entry.createdAt}>{germanDate(entry.createdAt, "feed")}</time></h3>
                  <p className="ow-day-sum"><strong>{entry.kind === "award" ? "Gutschrift" : entry.kind === "redeem" ? "Einlösung" : entry.kind === "expiry" ? "Verfallen" : "Korrektur"}{entry.rewardTitle ? ` · ${entry.rewardTitle}` : ""}</strong>
                    {` · ${entry.delta > 0 ? "+" : ""}${entry.delta} ${unitWord(entry.delta, kind)}`}{entry.kind !== "reversal" && ` · ${sourceLabel(entry.source)}`}{entry.reversed && " · später korrigiert"}
                    {entry.kind === "reversal" && entry.reversalOfId && (original ? ` · hebt ${original.kind === "award" ? "Gutschrift" : "Einlösung"} vom ${germanDate(original.createdAt, "feed")} auf` : " · hebt einen älteren Vorgang auf")}</p>
                  {entry.reason && <p className="ow-day-sum">Grund: {entry.reason}</p>}
                  {canAct && correctable(entry) && <button type="button" className="ow-qlink" onClick={() => openStep(`correct:${entry.id}`)}>Korrigieren</button>}
                </div>
              </div>;
            })}
          {olderError && <ErrorNotice message={olderError} onRetry={() => void loadOlder()} />}
          {nextCursor && <div className="ow-mt-3"><button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={() => void loadOlder()} disabled={olderBusy}>{olderBusy ? "Wird geladen …" : "Ältere Vorgänge laden"}</button></div>}
        </section>
        {!member.closedAt && <div>
          <h2>Karte</h2>
          {canAct ? <ul><li><button type="button" className="ow-prog-row" onClick={() => openStep("reissue")}>
            <span className="ow-prog-icon"><Link2 size={22} aria-hidden="true" /></span>
            <span className="ow-prog-main"><span className="ow-prog-text"><strong>Karte neu ausstellen</strong><small>Neuer Link bei verlorenem Kartenlink; Stand bleibt.</small></span></span>
            <ArrowRight className="ow-prog-arrow" size={22} aria-hidden="true" />
          </button></li></ul>
            : <p className="ow-prog-note">Korrigieren und neu ausstellen ist am Standort {member.locationName} möglich. Wechsle dazu den aktiven Standort.</p>}
        </div>}
      </div>
    </div>
  );
}

/** Back to the list the card came from, and the card number as the heading (a placeholder while it loads). */
function Head({ back, title, closed = false }: { back: { href: string; label: string }; title?: string; closed?: boolean }) {
  return <header className="ow-pagehead"><div className="ow-qhead">
    <Link href={back.href} scroll={false} className="ow-back"><ChevronLeft size={20} aria-hidden="true" />{back.label}</Link>
    {title ? <h1 tabIndex={-1}>{title}</h1> : <Skeleton height={34} width={200} />}
    {closed && <span className="ow-chip">Geschlossen</span>}
  </div></header>;
}
