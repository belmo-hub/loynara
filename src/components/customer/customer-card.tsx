"use client";

import { ArrowRight, CalendarCheck, CalendarClock, Check, ChevronRight, Clock, Download, Gift, Hourglass, Link2, Mail, Medal, Megaphone, RefreshCw, Wallet as WalletIcon, type LucideIcon } from "lucide-react";
import Image from "next/image";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { CustomerExportLink } from "@/components/customer-export-link";
import { NumberRoll } from "@/components/ui/number-roll";
import { Button } from "@/components/ui/button";
import { CustomerShell } from "@/components/ui/customer-shell";
import { Sheet } from "@/components/ui/sheet";
import { LegalLinks } from "@/components/ui/legal-links";
import { CardStatusLine, CardStatusProvider, useCardStatus } from "./card-status";
import { CardFace, nearestReward, type CardReward } from "./card-face";
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
 * The guest's card (mocks 23–26, ENG-148): an ending programme first, the goal as the page's heading, the card with the
 * code beside the QR like a Wallet pass, the green band only while a reward is ready, then section heads on the grey with
 * white rows. Wallet, rules and recovery open sheets from the „Deine Karte“ rows. From 960 px the goal and the card stay
 * on the left and the sections run on the right.
 */
export function CustomerCard(props: CustomerCardProps) {
  const { businessName, locationName, programType, balance, landed, landedCount, moment, rewards, cardLocator, qrSrc, brandColor, activity = [], rulesText, news, demoNotice, reviewUrl, happyHourUntil, pointsExpiry, challenge, level, winback, locale = "de", endsOn, notices, exportUrl, contactPanel, changes } = props;
  const t = copyFor(locale);
  const number = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "de-DE");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"wallet" | "rules" | "return" | "email" | null>(null);
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
  // The reward the progress text refers to: the one closest to redeemable, unless the guest picked another one.
  const nearest = nearestReward(rewards, balance);
  const selected = rewards.find((reward) => reward.id === selectedId) ?? nearest;
  const readyCount = rewards.filter((reward) => balance >= reward.cost).length;
  // During a booking moment the card steps from the balance last seen, but the words (goal line, ticket hint) speak of
  // the real balance from the start: a line count that changed at the step would move the card as the stamp lands.
  const told = moment ? moment.balance : balance;
  const toldSelected = rewards.find((reward) => reward.id === selectedId) ?? nearestReward(rewards, told);
  const toldReady = rewards.filter((reward) => told >= reward.cost).length;
  const toldNext = [...rewards].filter((reward) => reward.cost > told).sort((a, b) => a.cost - b.cost)[0];
  const notes = goodToKnow({ t, locale, programType, happyHourUntil, winback, pointsExpiry, challenge, level, changes, openRules: () => setSheet("rules") });
  const wallets = walletButtons(props, t);
  const hasRules = Boolean(rulesText || pointsExpiry || challenge || level);
  const activityRow = (item: CardActivity) => <ActivityRow key={item.id} late={!arriving}>
    <small className={styles.activityDay}>{item.date}</small><strong>{item.label}</strong>
    <b data-sign={item.change < 0 ? "minus" : undefined}>{item.change > 0 ? "+" : ""}{item.change} {t.unit(item.change, programType)}</b>
  </ActivityRow>;
  // The goal is the page's heading; a programme without a reward has none, so the shop's name takes the h1.
  const Name = selected ? "p" : "h1";

  const header = <div className={`customer-header ${styles.merchant}`}>
    <span className={styles.mono} aria-hidden="true">{Array.from(businessName)[0]}</span>
    <div className={styles.merchantText}><Name className={`customer-header-merchant ${styles.merchantName}`}>{businessName}</Name><span>{t.yourCard}</span></div>
    {wallets.length ? <button type="button" className={styles.headerWallet} aria-haspopup="dialog" aria-label={t.walletTitle} onClick={() => setSheet("wallet")}><WalletIcon size={22} aria-hidden="true" /></button> : null}
  </div>;

  return <CardStatusProvider><CustomerShell wide brandColor={brandColor} locale={locale} header={header} footer={<div className={styles.footer}><LegalLinks locale={locale} newTab /><p>{t.footer}</p></div>} cover={arriving && (!quiet || props.waited) ? cardSkeleton : undefined} className={quiet && !props.waited ? styles.returning : undefined}>
    <div className={styles.lead} data-arriving={arriving || undefined} data-return={quiet || undefined}>
      {/* Keyed by the balance: a second booking while the first pill still shows starts a new pill, with its own six seconds. */}
      {moment ? <BookingPill key={moment.balance} points={programType === "points"} credited={moment.credited} balance={moment.balance} locale={locale} /> : null}
      {demoNotice ? <div className={styles.ending}><p>{demoNotice}</p></div> : null}
      {endsOn ? <section className={styles.ending} aria-labelledby="customer-ending-title">
        <h2 id="customer-ending-title" className={styles.endingTitle}>{t.endsOn(endsOn)}</h2>
        <p>{t.endsWindow(programType === "points")}</p>
      </section> : null}

      <Goal t={t} number={number} programType={programType} balance={told} selected={toldSelected} readyCount={toldReady} nextGoal={toldNext} />
      {props.walletSaved ? <p className={styles.saved}><Check size={16} aria-hidden="true" />In Apple Wallet gespeichert</p> : null}

      <div className={`customer-balance-panel ${styles.cardGroup}`}>
        <div>
        <CardFace businessName={businessName} locationName={locationName} programType={programType} balance={balance} rewards={rewards} selected={selected} landed={landed} landedCount={landedCount} locale={locale} progress={false} tag={level?.name ?? undefined} grow={arriving && !moment}>
          <section className={`customer-qr-panel ${styles.ticket}`} aria-label={t.codeHeading}>
            {qrSrc ? <div className={`customer-qr ${styles.qr}`}><Image unoptimized src={qrSrc} alt={t.qrAlt} width={220} height={220} priority /></div> : <p className={styles.missingQr}>{t.missingQr}</p>}
            {cardLocator ? <p className={`customer-card-number ${styles.locator}`}><span>{t.cardNumber}</span><strong translate="no">{cardLocator}</strong><small>{toldReady > 0 ? t.showToRedeem : t.cardNumberHint}</small></p> : null}
          </section>
        </CardFace>
        {/* The band sits right under the card, before the refresh row (mock 24). */}
        {/* A reward this booking made ready: the slot opens together with the band, after the stamps have landed. */}
        {readyCount > 0 ? <div className={styles.bandSlot} data-arrive={(moment && !rewards.some((reward) => moment.balance - moment.credited >= reward.cost)) || undefined}><div><p className={styles.band}><span className={styles.bandIcon}><Gift size={22} aria-hidden="true" /></span><span><b>{t.readyTitle}</b><small>{t.readyText}</small></span></p></div></div> : null}
        </div>
        {props.onRefresh ? <div className={styles.refresh}>
          <Button variant="quiet" size="sm" className={styles.refreshButton} icon={<RefreshCw key={turn} size={16} className={turn ? styles.turn : undefined} />} onClick={() => { setTurn(turn + 1); props.onRefresh?.(); }} loading={props.refreshing}>{props.refreshing ? t.refreshing : t.refresh}</Button>
          {props.refreshFailed ? <p className={styles.alert} role="alert">{t.refreshFailed}</p> : null}
        </div> : null}
      </div>

      {notices}

    </div>

    <div className={styles.rest}>
      {notes.length ? <Section name="notes" title={t.goodToKnow}>
        <ul className={styles.rows}>{notes.map(({ key, icon: Icon, warn, body }) => <li key={key} className={styles.row}>
          <span className={styles.rowIcon} data-tone={warn ? "warn" : undefined}><Icon size={22} aria-hidden="true" /></span>
          <span className={styles.rowText}>{body}</span>
        </li>)}</ul>
      </Section> : null}

      {news ? <Section name="news" title={t.news}><p className={`${styles.card} ${styles.newsText}`}>{news}</p></Section> : null}

      {rewards.length ? <Section name="rewards" title={t.chooseReward}>
        <div role="group" aria-labelledby="customer-rewards-title" className={styles.rows}>
          {rewards.map((reward) => {
            // Like the goal line, the row speaks of the real balance during a booking moment, so it keeps its height at the step.
            const ready = told >= reward.cost;
            return <button key={reward.id} type="button" aria-pressed={rewards.length > 1 ? selected?.id === reward.id : undefined} className={styles.row} onClick={() => setSelectedId(reward.id)}>
              <span className={styles.rowIcon}><Gift size={22} aria-hidden="true" /></span>
              <span className={styles.rowMain}>
                <span className={styles.rowText}><strong>{reward.title}</strong><small>{number.format(reward.cost)} {t.unit(reward.cost, programType)}</small></span>
                {ready ? null : <span className={styles.rowValue}>{t.short(number.format(reward.cost - told))}</span>}
              </span>
              {ready ? <span className={styles.chipLine}><span className={styles.chip}><Check size={16} strokeWidth={3} aria-hidden="true" />{t.redeemable}</span></span> : null}
            </button>;
          })}
        </div>
      </Section> : null}

      {reviewUrl ? <p className={styles.links}><a href={reviewUrl} target="_blank" rel="noopener noreferrer">{t.review}</a></p> : null}

      <Section name="activity" title={t.activity} className="customer-activity">
        <div className={styles.card}>
          {/* Two lists on one column grid: the later rows open in place under the first three (Disclosure). */}
          {activity.length ? <div className={styles.activity}>
            <ul className={`customer-activity-list ${styles.activityRows}`}>{activity.slice(0, ACTIVITY_ROWS).map(activityRow)}</ul>
            {allActivity ? <div className={styles.activityMore}><ul className={styles.activityRows}>{activity.slice(ACTIVITY_ROWS).map(activityRow)}</ul></div> : null}
          </div> : <p className={styles.muted}>{t.activityEmpty}</p>}
          <Reveal open={activity.length > ACTIVITY_ROWS && !allActivity} gap="var(--space-3)"><button type="button" className={styles.showAll} onClick={() => setAllActivity(true)}>{t.showAll}</button></Reveal>
        </div>
      </Section>

      {contactPanel}

      <Section name="more" title={t.yourCardHead}>
        <div className={styles.rows}>
          {wallets.length ? <Signpost icon={WalletIcon} title={t.walletTitle} sub={t.walletRow} onOpen={() => setSheet("wallet")} /> : null}
          {props.email ? <Signpost icon={Mail} title={props.email.title} sub={props.email.sub} onOpen={() => setSheet("email")} /> : null}
          {props.walletError && sheet !== "wallet" ? <p className={`wallet-error ${styles.alert}`} role="alert">{props.walletError}</p> : null}
          {hasRules ? <Signpost icon={Megaphone} title={t.rules} onOpen={() => setSheet("rules")} /> : null}
          <Signpost icon={Link2} title={t.save} onOpen={() => setSheet("return")} />
          {exportUrl ? <div className={`${styles.row} ${styles.export}`}><span className={styles.rowIcon}><Download size={22} aria-hidden="true" /></span><CustomerExportLink url={exportUrl} locale={locale}>{t.export}</CustomerExportLink><ArrowRight className={styles.rowArrow} size={22} aria-hidden="true" /></div> : null}
        </div>
      </Section>
      {wallets.length ? <Wallet {...props} t={t} buttons={wallets} open={sheet === "wallet"} onClose={closeSheet} /> : null}
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
  return <li data-arrives={arrives || undefined}>{children}</li>;
}

/** The card page's placeholder, in the card's own classes, so it has the card's shape and columns. */
const cardSkeleton = {
  header: <div className={styles.merchant}><Skeleton width={36} height={36} radius={14} /><Skeleton width="45%" height={40} /></div>,
  main: <>
    <div className={styles.lead}>
      <div className={styles.goal}><Skeleton height={64} width="85%" /></div>
      <div className={styles.cardGroup}><Skeleton height={420} radius={28} /></div>
    </div>
    <div className={styles.rest}>
      <div className={styles.section}><Skeleton height={20} width="40%" /><Skeleton height={64} radius={20} /></div>
      <div className={styles.section}><Skeleton height={20} width="30%" /><Skeleton height={200} radius={20} /></div>
    </div>
  </>,
};

/** ENG-205: the card page's first paint after the join page: the bare ground and its heading, no placeholder. */
export function CustomerCardReturning({ label }: { label: string }) {
  return <CustomerShell wide><h1 className={styles.srOnly} aria-busy="true">{label}</h1></CustomerShell>;
}

/** The card page while it loads: the placeholder alone, in the frame the card then takes. `late`: it comes in over
 *  the bare ground of a return whose read has taken more than 300 ms, so it fades in. */
export function CustomerCardLoading({ label, late = false }: { label: string; late?: boolean }) {
  return <CustomerShell wide className={late ? styles.late : undefined} header={<div className={styles.loadingHead}>{cardSkeleton.header}</div>} footer={<LegalLinks locale="de" />}>
    <div className={styles.loading} aria-busy="true" aria-label={label}>{cardSkeleton.main}</div>
    <h1 className={styles.srOnly}>{label}</h1>
  </CustomerShell>;
}

/** A section head on the grey and what it heads. */
function Section({ name, title, className, children }: { name: string; title: string; className?: string; children: ReactNode }) {
  return <section className={className ? `${className} ${styles.section}` : styles.section} aria-labelledby={`customer-${name}-title`}>
    <h2 id={`customer-${name}-title`} className={styles.sectionHead}>{title}</h2>
    {children}
  </section>;
}

/** A row that opens a sheet: icon tile, title, sub-line and the arrow. */
function Signpost({ icon: Icon, title, sub, onOpen }: { icon: LucideIcon; title: string; sub?: string; onOpen: () => void }) {
  return <button type="button" className={styles.row} aria-haspopup="dialog" onClick={onOpen}>
    <span className={styles.rowIcon}><Icon size={22} aria-hidden="true" /></span>
    <span className={styles.rowText}><strong>{title}</strong>{sub ? <small>{sub}</small> : null}</span>
    <ArrowRight className={styles.rowArrow} size={22} aria-hidden="true" />
  </button>;
}

/** The one progress statement: how many are missing for which reward, or which reward is ready. */
function Goal({ t, number, programType, balance, selected, readyCount, nextGoal }: { t: Copy; number: Intl.NumberFormat; programType: "stamps" | "points"; balance: number; selected?: Reward; readyCount: number; nextGoal?: Reward }) {
  if (!selected) return null;
  const unitFor = (n: number) => t.unit(n, programType);
  const remaining = Math.max(0, selected.cost - balance);
  const sub = remaining > 0 ? (readyCount === 1 ? t.readyOne : readyCount > 1 ? t.readyMany(readyCount) : null)
    : readyCount > 1 ? t.readyMany(readyCount) : nextGoal ? t.nextGoal(number.format(nextGoal.cost - balance), unitFor(nextGoal.cost - balance), nextGoal.title) : null;
  return <div className={styles.goal}>
    <h1 className={`reward-remaining ${styles.goalLine}`}>{remaining === 0 ? t.readyFor
      : <>{t.still} <NumberRoll value={remaining} className={styles.goalNum}>{number.format(remaining)}</NumberRoll> {t.toReward(unitFor(remaining))}</>} <span className={`goal-reward ${styles.rewardName}`}>{selected.title}</span></h1>
    {sub ? <p className={styles.goalSub}>{sub}</p> : null}
  </div>;
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

function Wallet({ buttons, walletBusy = null, googleTestOnly, walletError, locale = "de", t, open, onClose }: CustomerCardProps & { t: Copy; buttons: WalletButton[]; open: boolean; onClose: () => void }) {
  return <Sheet open={open} onClose={onClose} title={t.walletTitle}>
    <div className={`customer-wallet-add ${styles.sheetBody}`}>
      <p className={styles.muted}>{t.walletIntro}</p>
      <div className={styles.walletButtons}>{buttons.map((button) => {
        const badge = walletBadge(button.id, locale);
        return <button key={button.id} type="button" className={`wallet-add wallet-add--${button.id} ${styles.walletButton}`} data-badge={badge ? true : undefined} onClick={button.onClick} disabled={walletBusy !== null} aria-busy={walletBusy === button.id} aria-label={badge ? undefined : walletBusy === button.id ? t.walletLoading : button.label}>
          {badge ? <Image unoptimized src={badge} alt={button.label} width={button.id === "google" ? 199 : 166} height={button.id === "google" ? 55 : 52} /> : <span>{walletBusy === button.id ? t.walletLoading : button.label}</span>}
        </button>;
      })}</div>
      <p className={`wallet-busy ${styles.walletBusy}`} role="status">{walletBusy !== null && walletBadge(walletBusy, locale) ? t.walletLoading : ""}</p>
      {googleTestOnly && buttons.some(button => button.id === "google") ? <p className={`wallet-mode-note ${styles.muted}`}>{t.googleDemo}</p> : null}
      {walletError && open ? <p className={`wallet-error ${styles.alert}`} role="alert">{walletError}</p> : null}
    </div>
  </Sheet>;
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
      <Button variant="secondary" size="sm" onClick={copyLink}><CopyLabel copied={copied} label={t.copyLink} done={french ? "Copié" : undefined} /></Button>
      <CardStatusLine text={status} live={live} className={styles.muted} />
    </div>
  </Sheet>;
}

function CloseCard({ onCloseCard, closeBusy, closeError, onAppleWallet, onGoogleWallet, t }: CustomerCardProps & { t: Copy }) {
  const [open, setOpen] = useState(false);
  return <section className={styles.close}>
    <button type="button" className={styles.closeToggle} aria-expanded={open} onClick={() => setOpen((value) => !value)}>{t.closeCard}<ChevronRight size={16} aria-hidden="true" /></button>
    <Reveal open={open} gap="var(--space-3)"><div className={`customer-close-confirm ${styles.closeConfirm}`}>
      <p>{t.closeMessage(Boolean(onAppleWallet || onGoogleWallet))}</p>
      <Button variant="danger" size="sm" onClick={() => void onCloseCard?.()} loading={closeBusy}>{closeBusy ? t.closing : t.confirmClose}</Button>
      {closeError ? <p className={styles.alert} role="alert">{closeError}</p> : null}
    </div></Reveal>
  </section>;
}

/**
 * The booking moment: „Stempel erhalten“ with what was added, floating over the shop header so nothing below moves.
 * It is never a target and leaves by itself. Screen readers hear one sentence: the status region is the hidden line
 * alone, mounted empty and filled a frame later, because a region that arrives with its text is often not read out.
 */
export function BookingPill({ points, credited, balance, locale }: { points: boolean; credited: number; balance: number; locale: "de" | "fr" }) {
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
    <span className={styles.pillCheck} aria-hidden="true"><Check size={22} strokeWidth={3} /></span>
    <strong aria-hidden="true">{title}</strong>
    <span className={styles.pillChip} aria-hidden="true">+{credited}</span>
    <span className={styles.srOnly} role={live ? "status" : undefined}>{spoken}</span>
  </div>;
}
