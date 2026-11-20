"use client";

import { CalendarCheck, CalendarClock, Check, ChevronRight, Clock, Gift, Hourglass, Medal, Minus, RefreshCw, RotateCw, type LucideIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { CustomerExportLink } from "@/components/customer-export-link";
import { NumberRoll } from "@/components/ui/number-roll";
import { Button } from "@/components/ui/button";
import { CustomerShell } from "@/components/ui/customer-shell";
import { Sheet } from "@/components/ui/sheet";
import { LegalLinks } from "@/components/ui/legal-links";
import { CardStatusLine, CardStatusProvider, useCardStatus } from "./card-status";
import { cardGoal, nearestReward, type CardReward } from "./card-face";
import { MixCard } from "./mix-card";
import { MixTile, mixStyles as mix } from "@/components/ui/mix";
import type { ChangeLine } from "@/lib/change-lines";
import { copyFor, type Copy } from "./customer-card-copy";
import styles from "./customer-card.module.css";
import { CopyLabel, useCopy } from "@/components/copy-text";
import { stampAnnouncement, tapCopy } from "@/components/tap-client";
import { MOMENT_PILL_MS } from "./booking-moment";
import { Reveal } from "./reveal";
import { Skeleton } from "@/components/ui/skeleton";
import { withUnit } from "@/lib/units";

type Reward = CardReward;
export type CardActivity = { id: string; label: string; date: string; change: number };

export type CustomerCardProps = {
  businessName: string;
  locationName: string;
  programType: "stamps" | "points";
  balance: number;
  /** A stamp count just reached; the last `landedCount` stamps land once. */
  landed?: number;
  landedCount?: number;
  /** A booking this device has not shown yet: the pill over the header says what was added and the balance it led to, until the page takes it away. */
  moment?: { credited: number; balance: number };
  /** ENG-205: the join page just showed this card being created. It opens as a return: no Card arrive, focus on its heading. */
  quiet?: boolean;
  /** That return's read was slow and the placeholder came in: the content takes its place as Skeleton to content. */
  waited?: boolean;
  rewards: Reward[];
  cardLocator?: string;
  qrSrc?: string;
  brandColor?: string;
  activity?: CardActivity[];
  rulesText?: string;
  /** The shop's short news line, plain text; absent = no panel. */
  news?: string;
  /** Demo environment only: Legal's demo line, at the top of the card. */
  demoNotice?: string;
  /** The shop's review link; a plain link, never tied to a reward. */
  reviewUrl?: string;
  /** End time of the running happy hour; one plain line, absent = none running. */
  happyHourUntil?: string;
  /** The card is inside its win-back window: the bonus and the window's last day (YYYY-MM-DD); absent = not in a window. */
  winback?: { bonus: number; until: string };
  /** Points expiry: the rule (shown with the rules from the first visit), each batch's date and the 30-day notice; absent = expiry off. */
  pointsExpiry?: { rule: string; batches: string[]; notice?: string };
  /** The shop's monthly challenge and this card's visit days so far; absent = none. */
  challenge?: { text: string; conditions: string; visits: number; target: number; done: boolean };
  /** The card's level and perk; absent = the shop has no levels. */
  level?: { name: "Bronze" | "Silber" | "Gold" | null; perk?: string; until?: string; visits: number; next: { name: string; visits: number } | null };
  locale?: "de" | "fr";
  /** The programme's last day (already formatted): stated first on the card, with what still works until then (ENG-075). */
  endsOn?: string;
  /** Binding prompts and errors from the card page, shown right under the code (the code comes first at the counter). */
  notices?: ReactNode;
  /** ENG-100: changes waiting for their date, one line each under the card (W31, W45, W46, W58); a long new rule is
   *  opens in full under its line („Neue Regel lesen“). */
  changes?: { lines: Array<ChangeLine | string>; newRule?: { on: string; text: string } };
  /** ENG-130 (08): the first card view after a device registered the Apple pass. */
  walletSaved?: boolean;
  /** ENG-130: a device holds the card's Apple pass, so the Apple add button is not offered again (the re-add notice still is). */
  appleSaved?: boolean;
  /** Offered only when the server reports the provider available; absent = no button at all. */
  onAppleWallet?: () => void;
  onGoogleWallet?: () => void;
  walletBusy?: "apple" | "google" | null;
  googleTestOnly?: boolean;
  /** Presentation only: which button comes first. Never an access decision. */
  walletPlatform?: "ios" | "android" | "other";
  walletError?: string;
  exportUrl?: string;
  contactPanel?: ReactNode;
  /** ENG-206: „Karte empfehlen“ under the card group, from the card's second team-confirmed booking. */
  referral?: ReactNode;
  /** ENG-165: the „E-Mail“ (or, while marketing mail is off, „Karte sichern“) row in „Deine Karte“ and the sheet it opens. */
  email?: { title: string; sub: string; sheet: (open: boolean, onClose: () => void) => ReactNode };
  /** With a confirmed address, „So findest du deine Karte wieder“ names the recovery page as a fourth way (E39). */
  recoverUrl?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  refreshFailed?: boolean;
  onCloseCard?: () => void | Promise<void>;
  closeBusy?: boolean;
  closeError?: string;
};

/**
 * The guest's card, in the founder's mix (17 Nov, ENG-255): „Deine Treuekarte“, the mix card with the goal in its foot,
 * the ticket with the code and the card number, the Wallet button, „Karte aktualisieren“, then the sections in white
 * panels („Letzte Aktivität“, „Deine Karte“), „Karte schließen“ and the legal links. One centred column at every width.
 * Blocks the picture does not draw (notices, „Gut zu wissen“, news, several rewards, contact panels) keep their place
 * in the order and take the mix panel.
 */
export function CustomerCard(props: CustomerCardProps) {
  const { businessName, locationName, programType, balance, landed, landedCount, moment, rewards, cardLocator, qrSrc, brandColor, activity = [], rulesText, news, demoNotice, reviewUrl, happyHourUntil, pointsExpiry, challenge, level, winback, locale = "de", endsOn, notices, exportUrl, contactPanel, changes } = props;
  const t = copyFor(locale);
  const number = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "de-DE");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"rules" | "return" | "email" | null>(null);
  const [allActivity, setAllActivity] = useState(false);
  const closeSheet = () => setSheet(null);
  // The first paint only: the placeholder fades off the page, the card settles and, without a booking moment, its
  // ladder fill grows. A later re-read (the page reads itself every few seconds) finds this off and replays nothing.
  const [arriving, setArriving] = useState(true);
  useEffect(() => { const timer = setTimeout(() => setArriving(false), ARRIVE_MS); return () => clearTimeout(timer); }, []);
  // After the join page the guest is told where they are: the card's heading takes the focus.
  const quiet = props.quiet === true;
  useEffect(() => { if (!quiet) return; const heading = document.querySelector<HTMLElement>("main h1"); if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); } }, [quiet]);
  // The icon answers each press with one turn, whatever the read takes.
  const [turn, setTurn] = useState(0);
  // The reward the card draws: the next one not reached yet (cardGoal), unless the guest picked another one. The goal
  // line below still names the reward closest to redeemable, so a ready reward is said first. While a booking moment
  // plays the goal is the one before it, so the grid does not change under the landing stamp (as the Kasse holds it).
  const selected = rewards.find((reward) => reward.id === selectedId) ?? cardGoal(rewards, moment ? moment.balance - moment.credited : balance);
  const readyCount = rewards.filter((reward) => balance >= reward.cost).length;
  // During a booking moment the card steps from the balance last seen, but the words (goal line, ticket hint) speak of
  // the real balance from the start: a line count that changed at the step would move the card as the stamp lands.
  const told = moment ? moment.balance : balance;
  const toldSelected = rewards.find((reward) => reward.id === selectedId) ?? nearestReward(rewards, told);
  const toldReady = rewards.filter((reward) => told >= reward.cost).length;
  const toldNext = [...rewards].filter((reward) => reward.cost > told).sort((a, b) => a.cost - b.cost)[0];
  // The reward moment (ENG-206): this booking made a reward ready. The card presses once the stamps have landed (CSS).
  // Points: the band opens once the last marker this booking crossed has pressed, 90 ms apart after --dur-ui (Design, 19 Nov).
  const crossed = moment ? rewards.filter((reward) => reward.cost <= moment.balance && reward.cost > moment.balance - moment.credited).length : 0;
  const bandDelay = programType === "points" && crossed ? { "--band-delay": `calc(var(--dur-ui) + var(--dur-reward) + ${(crossed - 1) * 90}ms)` } as CSSProperties : undefined;
  const rewardMoment = Boolean(moment && rewards.some((reward) => reward.cost <= moment.balance && reward.cost > moment.balance - moment.credited));
  const notes = goodToKnow({ t, locale, programType, happyHourUntil, winback, pointsExpiry, challenge, level, changes, openRules: () => setSheet("rules") });
  const wallets = walletButtons(props, t);
  const hasRules = Boolean(rulesText || pointsExpiry || challenge || level);
  const activityRow = (item: CardActivity) => <ActivityRow key={item.id} late={!arriving}>
    <MixTile tone={item.change < 0 ? "mute" : undefined}>{item.change < 0 ? <Minus size={20} /> : <Check size={20} />}</MixTile>
    <span className={mix.body}><span className={mix.text}><b>{item.label}</b><small className={styles.activityDay}>{item.date}</small></span>
      <span className={styles.amount} data-sign={item.change < 0 ? "minus" : undefined}><b>{item.change > 0 ? "+" : ""}{item.change}</b> <small>{t.unit(item.change, programType)}</small></span></span>
  </ActivityRow>;

  return <CardStatusProvider><CustomerShell brandColor={brandColor} locale={locale} footer={<div className={styles.footer}><LegalLinks locale={locale} newTab /><p>{t.footer}</p></div>} cover={arriving && (!quiet || props.waited) ? cardSkeleton : undefined} className={quiet && !props.waited ? `${styles.page} ${styles.returning}` : styles.page}>
    <div className={styles.lead} data-arriving={arriving || undefined} data-return={quiet || undefined} data-card-press={(rewardMoment && landed !== undefined) || undefined}>
      {/* Keyed by the balance: a second booking while the first pill still shows starts a new pill, with its own six seconds. */}
      {moment ? <BookingPill key={moment.balance} points={programType === "points"} credited={moment.credited} balance={moment.balance} locale={locale} /> : null}
      {demoNotice ? <div className={styles.ending}><p>{demoNotice}</p></div> : null}
      {endsOn ? <section className={styles.ending} aria-labelledby="customer-ending-title">
        <h2 id="customer-ending-title" className={styles.endingTitle}>{t.endsOn(endsOn)}</h2>
        <p>{t.endsWindow(programType === "points")}</p>
      </section> : null}

      <h1 className={`customer-header ${styles.eyebrow}`}>{t.yourCard}</h1>
      {props.walletSaved ? <p className={styles.saved}><Check size={16} aria-hidden="true" />In Apple Wallet gespeichert</p> : null}

      <div className={`customer-balance-panel ${styles.cardGroup}`}>
        <GuestMixCard className={`customer-card ${styles.object} ${styles.mix}`} businessName={businessName} locationName={locationName} programType={programType} balance={balance} reward={selected ?? NO_REWARD} rewards={rewards} landed={landed} landedCount={landedCount} grow={arriving && !moment} locale={locale}
          foot={<Goal t={t} number={number} programType={programType} balance={told} selected={toldSelected} readyCount={toldReady} nextGoal={toldNext} />} />
        {/* A reward this booking made ready: the slot opens together with the band, after the stamps have landed. */}
        {readyCount > 0 ? <div className={styles.bandSlot} data-arrive={(moment && !rewards.some((reward) => moment.balance - moment.credited >= reward.cost)) || undefined} style={bandDelay}><div><p className={styles.band}><span className={styles.bandIcon}><Gift size={22} aria-hidden="true" /></span><span><b>{t.readyTitle}</b><small>{t.readyText}</small></span></p></div></div> : null}
      </div>

      <section className={`customer-qr-panel ${mix.panel} ${mix.pad} ${styles.ticket}`} aria-label={t.codeHeading}>
        {qrSrc ? <div className={`customer-qr ${styles.qr}`}><Image unoptimized src={qrSrc} alt={t.qrAlt} width={220} height={220} priority /></div> : <p className={styles.missingQr}>{t.missingQr}</p>}
        {cardLocator ? <p className={`customer-card-number ${styles.locator}`}><span>{t.cardNumber}</span><strong translate="no">{cardLocator}</strong><small>{toldReady > 0 ? t.showToRedeem : t.cardNumberHint}</small></p> : null}
      </section>

      {wallets.length ? <Wallet {...props} t={t} buttons={wallets} /> : null}
      {props.onRefresh ? <div className={styles.refresh}>
        <Button variant="quiet" size="sm" className={styles.refreshButton} icon={<RotateCw key={turn} size={20} className={turn ? styles.turn : undefined} />} onClick={() => { setTurn(turn + 1); props.onRefresh?.(); }} loading={props.refreshing}>{props.refreshing ? t.refreshing : t.refresh}</Button>
        {props.refreshFailed ? <p className={styles.alert} role="alert">{t.refreshFailed}</p> : null}
      </div> : null}

      {notices}
      {props.referral}
    </div>

    <div className={styles.rest}>
      {notes.length ? <Section name="notes" title={t.goodToKnow}>
        <ul className={`${mix.panel} ${styles.list}`}>{notes.map(({ key, icon: Icon, warn, body }) => <li key={key} className={mix.row} data-lead="tile">
          <span className={mix.tile} data-tone={warn ? "warn" : "mute"} aria-hidden="true"><Icon size={20} /></span>
          <span className={mix.body}><span className={`${mix.text} ${styles.noteText}`}>{body}</span></span>
        </li>)}</ul>
      </Section> : null}

      {news ? <Section name="news" title={t.news}><p className={`${mix.panel} ${mix.pad} ${styles.newsText}`}>{news}</p></Section> : null}

      {/* „Deine Prämien“ only where there is a choice (ENG-255): with one reward the card's foot already names it. */}
      {rewards.length > 1 ? <Section name="rewards" title={t.chooseReward}>
        <div role="group" aria-labelledby="customer-rewards-title" className={mix.panel}>
          {rewards.map((reward) => {
            // Like the goal line, the row speaks of the real balance during a booking moment, so it keeps its height at the step.
            const ready = told >= reward.cost;
            return <button key={reward.id} type="button" aria-pressed={selected?.id === reward.id} className={`${mix.row} ${styles.rowButton}`} data-lead="tile" onClick={() => setSelectedId(reward.id)}>
              <MixTile tone={ready ? "coral" : undefined}><Gift size={20} /></MixTile>
              <span className={mix.body}><span className={mix.text}><b>{reward.title}</b><small>{number.format(reward.cost)} {t.unit(reward.cost, programType)}</small></span>
                {ready ? <span className={`${mix.chip} ${mix.warm}`}>{t.redeemable}</span> : <span className={mix.val}>{t.short(number.format(reward.cost - told))}</span>}
                <Check className={styles.picked} data-on={selected?.id === reward.id || undefined} size={20} aria-hidden="true" /></span>
            </button>;
          })}
        </div>
      </Section> : null}

      {reviewUrl ? <p className={styles.links}><a href={reviewUrl} target="_blank" rel="noopener noreferrer">{t.review}</a></p> : null}

      <Section name="activity" title={t.activity} className="customer-activity">
        {activity.length ? <div className={`${mix.panel} ${styles.activity}`}>
          <ul className={`customer-activity-list ${styles.list} ${styles.activityRows}`}>{activity.slice(0, ACTIVITY_ROWS).map(activityRow)}</ul>
          {/* The later rows open in place under the first three (Disclosure). */}
          {allActivity ? <div className={styles.activityMore}><ul className={`${styles.list} ${styles.activityRows}`}>{activity.slice(ACTIVITY_ROWS).map(activityRow)}</ul></div> : null}
          {activity.length > ACTIVITY_ROWS && !allActivity ? <button type="button" className={`${mix.more} ${styles.showAll}`} onClick={() => setAllActivity(true)}>{t.showAll}</button> : null}
        </div> : <p className={`${mix.panel} ${mix.pad} ${styles.muted}`}>{t.activityEmpty}</p>}
      </Section>

      {contactPanel}

      <Section name="more" title={t.yourCardHead}>
        <div className={mix.panel}>
          {props.email ? <Signpost title={props.email.title} sub={props.email.sub} onOpen={() => setSheet("email")} /> : null}
          {hasRules ? <Signpost title={t.rules} onOpen={() => setSheet("rules")} /> : null}
          <Signpost title={t.save} onOpen={() => setSheet("return")} />
          {/* The link is the row itself; the export's error line stands under it. */}
          {exportUrl ? <div className={styles.export}><CustomerExportLink url={exportUrl} locale={locale} linkClassName={`${mix.row} ${styles.rowButton}`}>{busy => <span className={mix.body}><span className={mix.text}><b>{busy ?? t.export}</b></span><ChevronRight className={mix.chev} size={20} aria-hidden="true" /></span>}</CustomerExportLink></div> : null}
        </div>
      </Section>
      {hasRules ? <Sheet open={sheet === "rules"} onClose={closeSheet} title={t.rules}>
        <div id="customer-rules" className={styles.sheetBody}>
          {rulesText ? <p className={styles.rules}>{rulesText}</p> : null}
          {pointsExpiry ? <p className={styles.rules}>{pointsExpiry.rule}</p> : null}
          {pointsExpiry?.batches.length ? <><p className={styles.rules}>{t.expiryList}</p><ul className={styles.rules}>{pointsExpiry.batches.map(line => <li key={line}>{line}</li>)}</ul></> : null}
          {challenge ? <p className={styles.rules}>{t.challenge}: {challenge.conditions}</p> : null}
          {level ? <p className={styles.rules}>{t.levelRule}</p> : null}
          <p className={styles.links}><a href="/teilnahmebedingungen" target="_blank" rel="noopener">{t.terms}</a></p>
        </div>
      </Sheet> : null}
      <ReturnSteps t={t} french={locale === "fr"} cardLocator={cardLocator} recoverUrl={locale === "de" ? props.recoverUrl : undefined} open={sheet === "return"} onClose={closeSheet} />
      {props.email?.sheet(sheet === "email", closeSheet)}

      {props.onCloseCard ? <CloseCard {...props} t={t} /> : null}
    </div>
  </CustomerShell></CardStatusProvider>;
}

/** A programme without a reward still draws the card; its foot then stays empty. */
const NO_REWARD: Reward = { id: "", title: "", cost: 0 };

/**
 * The mix card with the guest page's motion (ENG-008, #238): the stamps or ladder marks a booking just reached land
 * once, 90 ms apart, and the ladder fill grows on the first paint. Marks are set on the card's own elements before paint.
 * A points card's ladder also gets the booking's start (landedFrom) and grow from MixCard; the 90 ms stagger is set here.
 */
function GuestMixCard({ landed, landedCount = 1, className, ...card }: ComponentProps<typeof MixCard> & { landed?: number; landedCount?: number }) {
  const grow = card.grow;
  const ref = useRef<HTMLDivElement>(null);
  const goalId = card.reward.id;
  const reached = useRef<boolean[] | null>(null);
  useLayoutEffect(() => {
    const track = ref.current?.querySelector<HTMLElement>('[role="img"]');
    if (!track) return;
    track.toggleAttribute("data-grow", Boolean(grow));
    const marks = [...track.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.tagName === "SPAN");
    const now = marks.map(el => el.hasAttribute("data-on") || el.hasAttribute("data-reached"));
    const before = reached.current;
    reached.current = now;
    if (landed === undefined || !before) return;
    let order = 0;
    marks.forEach((el, i) => {
      if (!now[i] || before[i]) return;
      el.setAttribute("data-new", "");
      if (order > 0) el.style.setProperty("--land-stagger", `${order * 90}ms`);
      order += 1;
    });
  }, [landed, landedCount, grow, card.balance]);
  // A new goal (the hold released after a booking moment, or the guest picking another reward) is a crossfade, not a cut
  // (Design, #300). Only what changes is copied: the old stamp grid and count, with no ground, fade out over --dur-ui,
  // linear, over the new card at full opacity, so a stamp that stays earned keeps its pixels. The card's height eases to
  // the new one as the ready band's slot does, its shadow on the growing edge, and the foot slides down with that edge,
  // so no word stands in two places and what is below slides. Reduced motion keeps the cut.
  const shown = useRef<{ id: string; html: string; height: number; stampsEnd: number; footTop: number } | null>(null);
  const parts = (card: HTMLElement) => {
    const stamps = card.querySelector<HTMLElement>('[role="img"]');
    return { stamps, count: card.querySelector<HTMLElement>("[data-figure]")?.closest<HTMLElement>("div") ?? null, foot: stamps?.nextElementSibling as HTMLElement | null | undefined };
  };
  useLayoutEffect(() => {
    const box = ref.current, face = box?.firstElementChild as HTMLElement | null | undefined, before = shown.current;
    // Points: the ladder keeps its shape when the goal moves, so only the foot's words change, in place (Design, 19 Nov).
    if (!box || !face || !before || before.id === goalId || card.programType === "points") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeof box.animate !== "function") return;
    const now = parts(face);
    if (!now.stamps || !now.count) return;
    const root = getComputedStyle(document.documentElement);
    const ui = root.getPropertyValue("--dur-ui").trim(); // the minifier writes .22s, so the unit is read too
    const duration = parseFloat(ui) * (ui.endsWith("ms") ? 1 : 1000) || 220;
    const ease = root.getPropertyValue("--ease-out").trim() || "ease-out";
    // The old card as a hidden frame that shows only its stamps and count, clipped to the stamp area.
    const old = document.createElement("div");
    old.innerHTML = before.html;
    for (const node of old.querySelectorAll<HTMLElement>("*")) { node.removeAttribute("id"); node.removeAttribute("data-new"); node.style.animation = "none"; }
    const frame = old.firstElementChild as HTMLElement, then = parts(frame);
    Object.assign(frame.style, { visibility: "hidden", background: "none", boxShadow: "none" });
    for (const node of [then.stamps, then.count]) if (node) node.style.visibility = "visible";
    old.setAttribute("aria-hidden", "true");
    old.inert = true;
    Object.assign(old.style, { position: "absolute", inset: "0 0 auto", height: `${before.stampsEnd}px`, overflow: "hidden", pointerEvents: "none" });
    box.append(old);
    // While it grows the box clips the card to its rounded shape and wears the card's shadow, so the shadow follows the edge.
    const look = getComputedStyle(face);
    Object.assign(box.style, { overflow: "hidden", borderRadius: look.borderRadius, boxShadow: look.boxShadow });
    Object.assign(face.style, { boxShadow: "none" });
    const grow = box.animate([{ height: `${before.height}px` }, { height: `${face.offsetHeight}px` }], { duration, easing: ease });
    old.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: "linear", fill: "forwards" });
    const slide = now.foot?.animate([{ transform: `translateY(${before.footTop - now.foot.offsetTop}px)` }, { transform: "none" }], { duration, easing: ease });
    const done = () => { old.remove(); Object.assign(box.style, { overflow: "", borderRadius: "", boxShadow: "" }); Object.assign(face.style, { boxShadow: "" }); };
    grow.finished.then(done, done);
    return () => { grow.cancel(); slide?.cancel(); done(); };
  }, [goalId, card.programType]);
  // What the card looked like after this render: the next goal change fades its stamps and count out.
  useLayoutEffect(() => {
    const face = ref.current?.firstElementChild as HTMLElement | null | undefined;
    if (!face) return;
    const { stamps, foot } = parts(face);
    shown.current = { id: goalId, html: face.outerHTML, height: face.offsetHeight, stampsEnd: stamps ? stamps.offsetTop + stamps.offsetHeight : 0, footTop: foot?.offsetTop ?? 0 };
  });
  return <div ref={ref} className={className}><MixCard {...card} landedFrom={landed === undefined ? undefined : landed - landedCount} /></div>;
}

/** Rows of activity before „Alle anzeigen“ (G-21). */
const ACTIVITY_ROWS = 3;
/** How long the first paint's motion may run: Bars grow takes --dur-reward (480 ms) from the first frame. */
const ARRIVE_MS = 520;

/**
 * One activity row. A row that joins a page already painted (opened by „Alle anzeigen“, or added by a later read)
 * arrives; the rows of the first paint stand still under the placeholder. Decided once, when the row is made.
 */
function ActivityRow({ late, children }: { late: boolean; children: ReactNode }) {
  const [arrives] = useState(late);
  return <li className={mix.row} data-lead="tile" data-arrives={arrives || undefined}>{children}</li>;
}

/** The card page's placeholder, in the card's own classes, so it has the card's shape and the page's rhythm. */
const cardSkeleton = {
  main: <>
    <div className={styles.lead}>
      <Skeleton className={styles.eyebrow} width="40%" height={24} />
      <div className={styles.cardGroup}><Skeleton height={315} radius={28} /></div>
      <Skeleton height={168} radius={20} />
    </div>
    <div className={styles.rest}>
      <div className={`${mix.sec} ${styles.section}`}><Skeleton height={26} width="40%" /><Skeleton height={200} radius={20} /></div>
    </div>
  </>,
};

/** ENG-205: the card page's first paint after the join page: the bare ground and its heading, no placeholder. */
export function CustomerCardReturning({ label }: { label: string }) {
  return <CustomerShell><h1 className={styles.srOnly} aria-busy="true">{label}</h1></CustomerShell>;
}

/** The card page while it loads: the placeholder alone, in the frame the card then takes. `late`: it comes in over
 *  the bare ground of a return whose read has taken more than 300 ms, so it fades in. */
export function CustomerCardLoading({ label, late = false }: { label: string; late?: boolean }) {
  return <CustomerShell className={late ? styles.late : undefined} footer={<LegalLinks locale="de" />}>
    <div className={styles.loading} aria-busy="true" aria-label={label}>{cardSkeleton.main}</div>
    <h1 className={styles.srOnly}>{label}</h1>
  </CustomerShell>;
}

/** A mix section: its title 12 above its panel, 32 under the block before it. */
function Section({ name, title, className, children }: { name: string; title: string; className?: string; children: ReactNode }) {
  return <section className={`${className ? `${className} ` : ""}${mix.sec} ${styles.section}`} aria-labelledby={`customer-${name}-title`}>
    <h2 id={`customer-${name}-title`} className={mix.h}>{title}</h2>
    {children}
  </section>;
}

/** A „Deine Karte“ row that opens a sheet: title, sub line, the chevron. */
function Signpost({ title, sub, onOpen }: { title: string; sub?: string; onOpen: () => void }) {
  return <button type="button" className={`${mix.row} ${styles.rowButton}`} aria-haspopup="dialog" onClick={onOpen}>
    <span className={mix.body}><span className={mix.text}><b>{title}</b>{sub ? <small>{sub}</small> : null}</span><ChevronRight className={mix.chev} size={20} aria-hidden="true" /></span>
  </button>;
}

/** The goal in the card's foot: how many are missing for which reward, or which reward is ready, the reward on its own line. */
function Goal({ t, number, programType, balance, selected, readyCount, nextGoal }: { t: Copy; number: Intl.NumberFormat; programType: "stamps" | "points"; balance: number; selected?: Reward; readyCount: number; nextGoal?: Reward }) {
  if (!selected) return null;
  const unitFor = (n: number) => t.unit(n, programType);
  const remaining = Math.max(0, selected.cost - balance);
  const sub = remaining > 0 ? (readyCount === 1 ? t.readyOne : readyCount > 1 ? t.readyMany(readyCount) : null)
    : readyCount > 1 ? t.readyMany(readyCount) : nextGoal ? t.nextGoal(number.format(nextGoal.cost - balance), unitFor(nextGoal.cost - balance), nextGoal.title) : null;
  return <>
    <p className={`reward-remaining ${styles.goalLine}`}>{remaining === 0 ? t.readyFor
      : <>{t.still} <NumberRoll value={remaining} className={styles.goalNum}>{number.format(remaining)}</NumberRoll> {t.toReward(unitFor(remaining))}</>} <span className={`goal-reward ${styles.rewardName}`}>{selected.title}</span></p>
    {sub ? <p className={styles.goalSub}>{sub}</p> : null}
  </>;
}

type Note = { key: string; icon: LucideIcon; warn?: boolean; body: ReactNode };

/**
 * „Gut zu wissen“: ENG-100's dated changes first, then the time-bound extras, nearest deadline first (Head of Design,
 * 23 Oct): a happy hour running now ends today, a win-back window within 14 days, the expiry notice covers the next 30
 * days, the challenge ends with the month, the level runs 90 days. Their fine print lives in the programme rules.
 */
function goodToKnow({ t, locale, programType, happyHourUntil, winback, pointsExpiry, challenge, level, changes, openRules }: Pick<CustomerCardProps, "locale" | "programType" | "happyHourUntil" | "winback" | "pointsExpiry" | "challenge" | "level" | "changes"> & { t: Copy; openRules: () => void }): Note[] {
  const notes: Note[] = (changes?.lines ?? []).map(line => {
    const { text, link } = typeof line === "string" ? { text: line, link: false } : line;
    return { key: text, icon: CalendarClock, warn: true, body: link && changes?.newRule ? <NewRuleLine text={text} rule={changes.newRule.text} /> : <span>{text}</span> };
  });
  if (happyHourUntil) notes.push({ key: "happy", icon: Clock, body: <span>{t.happyHour(happyHourUntil)}</span> });
  if (winback) {
    const day = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "de-DE", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${winback.until}T00:00:00Z`));
    // Legal (24 Oct): the „Bedingungen“ link to the rules stays with the line, so the exclusions can stay out of it.
    notes.push({ key: "winback", icon: RefreshCw, body: <span>{t.winback(programType === "points", winback.bonus, day)} <button type="button" aria-haspopup="dialog" className={styles.inlineLink} onClick={openRules}>{t.conditions}</button></span> });
  }
  if (pointsExpiry?.notice) notes.push({ key: "expiry", icon: Hourglass, warn: true, body: <span role="status">{pointsExpiry.notice}</span> });
  if (challenge) notes.push({ key: "challenge", icon: CalendarCheck, body: <>
    <strong>{t.challenge}</strong><small>{challenge.text}</small><small className={styles.ink}>{challenge.done ? t.challengeDone : t.challengeProgress(challenge.visits, challenge.target)}</small>
  </> });
  // A card without a level yet gets no row (G-13); the level rule stays in the programme rules.
  if (level?.name) notes.push({ key: "level", icon: Medal, body: <>
    <strong>{t.levelTitle(level.name)}</strong>
    {level.until ? <small><b className={styles.ink}>{t.levelUntil(level.name, level.until)}</b>{t.levelUntilRest}</small> : null}
    {level.perk ? <small>{t.perk(level.perk)}</small> : null}
    <small>{level.next ? t.levelNext(level.next.visits, level.next.name) : t.levelTop}</small>
  </> });
  return notes;
}

/** A dated new rule: its line, and the long rule opening in place under it (Design, as on the join page). */
function NewRuleLine({ text, rule }: { text: string; rule: string }) {
  const [open, setOpen] = useState(false);
  return <span>{text}{" "}
    <button type="button" className={styles.ruleToggle} aria-expanded={open} aria-controls="customer-new-rule" onClick={() => setOpen(!open)}>{open ? "Neue Regel ausblenden" : "Neue Regel lesen"}</button>
    {open ? <span id="customer-new-rule" className={styles.newRule}>{rule}</span> : null}
  </span>;
}

type WalletButton = { id: "apple" | "google"; label: string; onClick: () => void };

/** The Add to Wallet buttons this device gets. Platform only orders and narrows what is shown; the server decides availability. */
function walletButtons({ onAppleWallet, onGoogleWallet, walletPlatform = "other", appleSaved }: CustomerCardProps, t: Copy): WalletButton[] {
  const apple = onAppleWallet && walletPlatform !== "android" && !appleSaved ? [{ id: "apple" as const, label: t.addApple, onClick: onAppleWallet }] : [];
  const google = onGoogleWallet && walletPlatform !== "ios" ? [{ id: "google" as const, label: t.addGoogle, onClick: onGoogleWallet }] : [];
  return walletPlatform === "android" ? [...google, ...apple] : [...apple, ...google];
}

/** The provider's badge artwork where we have it (Apple's: German only, ENG-132), else the house button with its wording. */
const walletBadge = (id: WalletButton["id"], locale: "de" | "fr") => id === "google" ? `/wallet/google-add-${locale}.svg` : locale === "de" ? "/wallet/apple-add-de.svg" : null;

/** The Add to Wallet buttons under the ticket (the mix: no sheet in between). Apple's badge is never dimmed while busy; the line under it says so. */
function Wallet({ buttons, walletBusy = null, googleTestOnly, walletError, locale = "de", t }: CustomerCardProps & { t: Copy; buttons: WalletButton[] }) {
  return <div className={`customer-wallet-add ${styles.walletButtons}`}>
    {buttons.map((button) => {
      const badge = walletBadge(button.id, locale);
      return <button key={button.id} type="button" className={`wallet-add wallet-add--${button.id} ${styles.walletButton}`} data-badge={badge ? true : undefined} onClick={button.onClick} disabled={walletBusy !== null} aria-busy={walletBusy === button.id} aria-label={badge ? undefined : walletBusy === button.id ? t.walletLoading : button.label}>
        {badge ? <Image unoptimized src={badge} alt={button.label} width={button.id === "google" ? 199 : 166} height={button.id === "google" ? 55 : 52} /> : <span>{walletBusy === button.id ? t.walletLoading : button.label}</span>}
      </button>;
    })}
    <p className={`wallet-busy ${styles.walletBusy}`} role="status">{walletBusy !== null && walletBadge(walletBusy, locale) ? t.walletLoading : ""}</p>
    {googleTestOnly && buttons.some(button => button.id === "google") ? <p className={`wallet-mode-note ${styles.muted}`}>{t.googleDemo}</p> : null}
    {walletError ? <p className={`wallet-error ${styles.alert}`} role="alert">{walletError}</p> : null}
  </div>;
}

function ReturnSteps({ t, french, cardLocator, recoverUrl, open, onClose }: { t: Copy; french: boolean; cardLocator?: string; recoverUrl?: string; open: boolean; onClose: () => void }) {
  const { text: status, live, announce: setStatus } = useCardStatus("return");
  const { copied, copy } = useCopy();
  async function copyLink() {
    setStatus(await copy(new URL(window.location.pathname, window.location.origin).href) ? t.copied : t.copyFailed);
  }
  return <Sheet open={open} onClose={onClose} title={t.save}>
    <div className={`customer-wallet ${styles.sheetBody}`}>
      <ol className={`customer-return-steps ${styles.steps}`}>
        <li>{t.stepBookmark}</li>
        <li>{t.stepScanAgain}</li>
        {cardLocator ? <li>{t.stepNumber(cardLocator)}</li> : null}
        {recoverUrl ? <li>Oder gib unter {recoverUrl} deine bestätigte E-Mail-Adresse ein.</li> : null}
      </ol>
      <p className={styles.muted}>{t.linkWarning}</p>
      <Button variant="secondary" onClick={copyLink}><CopyLabel copied={copied} label={t.copyLink} done={french ? "Copié" : undefined} /></Button>
      <CardStatusLine text={status} live={live} className={styles.muted} />
    </div>
  </Sheet>;
}

function CloseCard({ onCloseCard, closeBusy, closeError, onAppleWallet, onGoogleWallet, t }: CustomerCardProps & { t: Copy }) {
  const [open, setOpen] = useState(false);
  return <section className={`${styles.section} ${styles.close}`}>
    <button type="button" className={`${mix.panel} ${styles.closeToggle}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>{t.closeCard}</button>
    <Reveal open={open} gap="var(--space-3)"><div className={`customer-close-confirm ${styles.closeConfirm}`}>
      <p>{t.closeMessage(Boolean(onAppleWallet || onGoogleWallet))}</p>
      <Button variant="danger" size="sm" block onClick={() => void onCloseCard?.()} loading={closeBusy}>{closeBusy ? t.closing : t.confirmClose}</Button>
      {closeError ? <p className={styles.alert} role="alert">{closeError}</p> : null}
    </div></Reveal>
  </section>;
}

/**
 * The booking moment: „Stempel erhalten“ with what was added, floating over the shop header so nothing below moves.
 * It is never a target and leaves by itself. Screen readers hear one sentence: the status region is the hidden line
 * alone, mounted empty and filled a frame later, because a region that arrives with its text is often not read out.
 */
function BookingPill({ points, credited, balance, locale }: { points: boolean; credited: number; balance: number; locale: "de" | "fr" }) {
  const { live, announce } = useCardStatus("moment");
  // No new French copy for now: a French card says what was added in the unit words the card already uses.
  const french = locale === "fr" ? withUnit(credited, points ? "points" : "stamps", "fr") : null;
  const title = french ?? tapCopy("confirmed", undefined, points).title;
  const said = french ?? stampAnnouncement("confirmed", balance, points, credited) ?? "";
  const [spoken, setSpoken] = useState("");
  useEffect(() => { announce(said); }, [announce, said]);
  // The line is filled only once it is the page's status region, a frame after the role is on it.
  useEffect(() => {
    if (!live) return;
    const frame = requestAnimationFrame(() => setSpoken(said));
    return () => cancelAnimationFrame(frame);
  }, [live, said]);
  return <div className={styles.pill} style={{ "--pill-stay": `${MOMENT_PILL_MS}ms` } as CSSProperties}>
    <span className={styles.pillCheck} aria-hidden="true"><Check size={22} /></span>
    <strong aria-hidden="true">{title}</strong>
    <span className={styles.pillChip} aria-hidden="true">+{credited}</span>
    <span className={styles.srOnly} role={live ? "status" : undefined}>{spoken}</span>
  </div>;
}
