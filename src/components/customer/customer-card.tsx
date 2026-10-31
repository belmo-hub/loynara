"use client";

import { ArrowRight, CalendarCheck, CalendarClock, Check, ChevronRight, Clock, Download, Gift, Hourglass, Link2, Medal, Megaphone, RefreshCw, Wallet as WalletIcon, type LucideIcon } from "lucide-react";
import Image from "next/image";
import { useState, type ReactNode } from "react";
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
import { copyText } from "@/components/copy-text";

type Reward = CardReward;
export type CardActivity = { id: string; label: string; date: string; change: number };

export type CustomerCardProps = {
  businessName: string;
  locationName: string;
  programType: "stamps" | "points";
  balance: number;
  /** A stamp count reached while the card was open; that stamp lands once. */
  landed?: number;
  rewards: Reward[];
  cardLocator?: string;
  qrSrc?: string;
  brandColor?: string;
  activity?: CardActivity[];
  rulesText?: string;
  /** The shop's short news line, plain text; absent = no panel. */
  news?: string;
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
  const { businessName, locationName, programType, balance, landed, rewards, cardLocator, qrSrc, brandColor, activity = [], rulesText, news, reviewUrl, happyHourUntil, pointsExpiry, challenge, level, winback, locale = "de", endsOn, notices, exportUrl, contactPanel, changes } = props;
  const t = copyFor(locale);
  const number = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "de-DE");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"wallet" | "rules" | "return" | null>(null);
  const [allActivity, setAllActivity] = useState(false);
  const closeSheet = () => setSheet(null);
  // The reward the progress text refers to: the one closest to redeemable, unless the guest picked another one.
  const nearest = nearestReward(rewards, balance);
  const selected = rewards.find((reward) => reward.id === selectedId) ?? nearest;
  const readyCount = rewards.filter((reward) => balance >= reward.cost).length;
  const nextGoal = [...rewards].filter((reward) => reward.cost > balance).sort((a, b) => a.cost - b.cost)[0];
  const notes = goodToKnow({ t, locale, programType, happyHourUntil, winback, pointsExpiry, challenge, level, changes, openRules: () => setSheet("rules") });
  const wallets = walletButtons(props, t);
  const hasRules = Boolean(rulesText || pointsExpiry || challenge || level);
  const shown = allActivity ? activity : activity.slice(0, ACTIVITY_ROWS);
  // The goal is the page's heading; a programme without a reward has none, so the shop's name takes the h1.
  const Name = selected ? "p" : "h1";

  const header = <div className={`customer-header ${styles.merchant}`}>
    <span className={styles.mono} aria-hidden="true">{Array.from(businessName)[0]}</span>
    <div className={styles.merchantText}><Name className={`customer-header-merchant ${styles.merchantName}`}>{businessName}</Name><span>{t.yourCard}</span></div>
    {wallets.length ? <button type="button" className={styles.headerWallet} aria-haspopup="dialog" aria-label={t.walletTitle} onClick={() => setSheet("wallet")}><WalletIcon size={22} aria-hidden="true" /></button> : null}
  </div>;

  return <CardStatusProvider><CustomerShell wide brandColor={brandColor} locale={locale} header={header} footer={<div className={styles.footer}><LegalLinks locale={locale} newTab /><p>{t.footer}</p></div>}>
    <div className={styles.lead}>
      {endsOn ? <section className={styles.ending} aria-labelledby="customer-ending-title">
        <h2 id="customer-ending-title" className={styles.endingTitle}>{t.endsOn(endsOn)}</h2>
        <p>{t.endsWindow(programType === "points")}</p>
      </section> : null}

      <Goal t={t} number={number} programType={programType} balance={balance} selected={selected} readyCount={readyCount} nextGoal={nextGoal} />
      {props.walletSaved ? <p className={styles.saved}><Check size={16} aria-hidden="true" />In Apple Wallet gespeichert</p> : null}

      <div className={`customer-balance-panel ${styles.cardGroup}`}>
        <CardFace businessName={businessName} locationName={locationName} programType={programType} balance={balance} rewards={rewards} selected={selected} landed={landed} locale={locale} progress={false} tag={level?.name ?? undefined}>
          <section className={`customer-qr-panel ${styles.ticket}`} aria-label={t.codeHeading}>
            {qrSrc ? <div className={`customer-qr ${styles.qr}`}><Image unoptimized src={qrSrc} alt={t.qrAlt} width={220} height={220} priority /></div> : <p className={styles.missingQr}>{t.missingQr}</p>}
            {cardLocator ? <p className={`customer-card-number ${styles.locator}`}><span>{t.cardNumber}</span><strong translate="no">{cardLocator}</strong><small>{readyCount > 0 ? t.showToRedeem : t.cardNumberHint}</small></p> : null}
          </section>
        </CardFace>
        {/* The band sits right under the card, before the refresh row (mock 24). */}
        {readyCount > 0 ? <p className={styles.band}><span className={styles.bandIcon}><Gift size={22} aria-hidden="true" /></span><span><b>{t.readyTitle}</b><small>{t.readyText}</small></span></p> : null}
        {props.onRefresh ? <div className={styles.refresh}>
          <Button variant="quiet" size="sm" className={styles.refreshButton} icon={<RefreshCw size={16} />} onClick={props.onRefresh} loading={props.refreshing}>{props.refreshing ? t.refreshing : t.refresh}</Button>
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
            const ready = balance >= reward.cost;
            return <button key={reward.id} type="button" aria-pressed={rewards.length > 1 ? selected?.id === reward.id : undefined} className={styles.row} onClick={() => setSelectedId(reward.id)}>
              <span className={styles.rowIcon}><Gift size={22} aria-hidden="true" /></span>
              <span className={styles.rowMain}>
                <span className={styles.rowText}><strong>{reward.title}</strong><small>{number.format(reward.cost)} {t.unit(reward.cost, programType)}</small></span>
                {ready ? null : <span className={styles.rowValue}>{t.short(number.format(reward.cost - balance))}</span>}
              </span>
              {ready ? <span className={styles.chipLine}><span className={styles.chip}><Check size={16} strokeWidth={3} aria-hidden="true" />{t.redeemable}</span></span> : null}
            </button>;
          })}
        </div>
      </Section> : null}

      {reviewUrl ? <p className={styles.links}><a href={reviewUrl} target="_blank" rel="noopener noreferrer">{t.review}</a></p> : null}

      <Section name="activity" title={t.activity} className="customer-activity">
        <div className={styles.card}>
          {activity.length ? <ul className={`customer-activity-list ${styles.activity}`}>{shown.map((item) => <li key={item.id}>
            <small className={styles.activityDay}>{item.date}</small><strong>{item.label}</strong>
            <b data-sign={item.change < 0 ? "minus" : undefined}>{item.change > 0 ? "+" : ""}{item.change} {t.unit(item.change, programType)}</b>
          </li>)}</ul> : <p className={styles.muted}>{t.activityEmpty}</p>}
          {activity.length > ACTIVITY_ROWS && !allActivity ? <button type="button" className={styles.showAll} onClick={() => setAllActivity(true)}>{t.showAll}</button> : null}
        </div>
      </Section>

      {contactPanel}

      <Section name="more" title={t.yourCardHead}>
        <div className={styles.rows}>
          {wallets.length ? <Signpost icon={WalletIcon} title={t.walletTitle} sub={t.walletRow} onOpen={() => setSheet("wallet")} /> : null}
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
      <ReturnSteps t={t} cardLocator={cardLocator} open={sheet === "return"} onClose={closeSheet} />

      {props.onCloseCard ? <CloseCard {...props} t={t} /> : null}
    </div>
  </CustomerShell></CardStatusProvider>;
}

/** Rows of activity before „Alle anzeigen“ (G-21). */
const ACTIVITY_ROWS = 3;

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

function Wallet({ buttons, walletBusy = null, googleTestOnly, walletError, locale = "de", t, open, onClose }: CustomerCardProps & { t: Copy; buttons: WalletButton[]; open: boolean; onClose: () => void }) {
  return <Sheet open={open} onClose={onClose} title={t.walletTitle}>
    <div className={`customer-wallet-add ${styles.sheetBody}`}>
      <p className={styles.muted}>{t.walletIntro}</p>
      <div className={styles.walletButtons}>{buttons.map((button) => <button key={button.id} type="button" className={`wallet-add wallet-add--${button.id} ${styles.walletButton}`} onClick={button.onClick} disabled={walletBusy !== null} aria-busy={walletBusy === button.id} aria-label={walletBusy === button.id ? t.walletLoading : button.label}>
        {button.id === "google" ? <Image unoptimized src={`/wallet/google-add-${locale}.svg`} alt={button.label} width={199} height={55} /> : <span>{walletBusy === button.id ? t.walletLoading : button.label}</span>}
      </button>)}</div>
      {googleTestOnly && buttons.some(button => button.id === "google") ? <p className={`wallet-mode-note ${styles.muted}`}>{t.googleDemo}</p> : null}
      {walletError && open ? <p className={`wallet-error ${styles.alert}`} role="alert">{walletError}</p> : null}
    </div>
  </Sheet>;
}

function ReturnSteps({ t, cardLocator, open, onClose }: { t: Copy; cardLocator?: string; open: boolean; onClose: () => void }) {
  const { text: status, live, announce: setStatus } = useCardStatus("return");
  async function copyLink() {
    setStatus(await copyText(new URL(window.location.pathname, window.location.origin).href) ? t.copied : t.copyFailed);
  }
  return <Sheet open={open} onClose={onClose} title={t.save}>
    <div className={`customer-wallet ${styles.sheetBody}`}>
      <ol className={`customer-return-steps ${styles.steps}`}>
        <li>{t.stepBookmark}</li>
        <li>{t.stepScanAgain}</li>
        {cardLocator ? <li>{t.stepNumber(cardLocator)}</li> : null}
      </ol>
      <p className={styles.muted}>{t.linkWarning}</p>
      <Button variant="secondary" size="sm" onClick={copyLink}>{t.copyLink}</Button>
      <CardStatusLine text={status} live={live} className={styles.muted} />
    </div>
  </Sheet>;
}

function CloseCard({ onCloseCard, closeBusy, closeError, onAppleWallet, onGoogleWallet, t }: CustomerCardProps & { t: Copy }) {
  const [open, setOpen] = useState(false);
  return <section className={styles.close}>
    <button type="button" className={styles.closeToggle} aria-expanded={open} onClick={() => setOpen((value) => !value)}>{t.closeCard}<ChevronRight size={16} aria-hidden="true" /></button>
    {open ? <div className={`customer-close-confirm ${styles.closeConfirm}`}>
      <p>{t.closeMessage(Boolean(onAppleWallet || onGoogleWallet))}</p>
      <Button variant="danger" size="sm" onClick={() => void onCloseCard?.()} loading={closeBusy}>{closeBusy ? t.closing : t.confirmClose}</Button>
      {closeError ? <p className={styles.alert} role="alert">{closeError}</p> : null}
    </div> : null}
  </section>;
}
