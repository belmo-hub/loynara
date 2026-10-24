"use client";

import { ChevronRight, History, RefreshCw } from "lucide-react";
import Image from "next/image";
import { useState, type ReactNode } from "react";
import { CustomerExportLink } from "@/components/customer-export-link";
import { Badge } from "@/components/ui/badge";
import { NumberRoll } from "@/components/ui/number-roll";
import { Button } from "@/components/ui/button";
import { CustomerShell } from "@/components/ui/customer-shell";
import { CardStatusLine, CardStatusProvider, useCardStatus } from "./card-status";
import { CardFace, nearestReward, type CardReward } from "./card-face";
import { copyFor, type Copy } from "./customer-card-copy";
import styles from "./customer-card.module.css";

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
 * The guest's card: an ending programme first, then one progress line that names the reward, the card itself with the
 * code inset like a Wallet pass, at most one highlighted extra, then everything that keeps the card findable.
 */
export function CustomerCard(props: CustomerCardProps) {
  const { businessName, locationName, programType, balance, landed, rewards, cardLocator, qrSrc, brandColor, activity = [], rulesText, news, reviewUrl, happyHourUntil, pointsExpiry, challenge, level, locale = "de", endsOn, notices, exportUrl, contactPanel } = props;
  const t = copyFor(locale);
  const number = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "de-DE");
  const unit = programType === "points" ? t.points : t.stamps;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The reward the progress text refers to: the one closest to redeemable, unless the guest picked another one.
  const nearest = nearestReward(rewards, balance);
  const selected = rewards.find((reward) => reward.id === selectedId) ?? nearest;
  const readyCount = rewards.filter((reward) => balance >= reward.cost).length;
  const nextGoal = [...rewards].filter((reward) => reward.cost > balance).sort((a, b) => a.cost - b.cost)[0];

  const header = <div className={`customer-header ${styles.merchant}`}>
    <span className={styles.mono} aria-hidden="true">{Array.from(businessName)[0]}</span>
    <div className={styles.merchantText}><h1 className={`customer-header-merchant ${styles.merchantName}`}>{businessName}</h1><span>{t.yourCard}</span></div>
  </div>;

  return <CardStatusProvider><CustomerShell brandColor={brandColor} locale={locale} header={header} footer={<p className={styles.footer}>{t.footer}</p>}>
    {endsOn ? <section className={styles.ending} aria-labelledby="customer-ending-title">
      <h2 id="customer-ending-title" className={styles.endingTitle}>{t.endsOn(endsOn)}</h2>
      <p>{t.endsWindow(programType === "points")}</p>
    </section> : null}

    <Goal t={t} number={number} programType={programType} balance={balance} selected={selected} readyCount={readyCount} nextGoal={nextGoal} />

    <div className={`customer-balance-panel ${styles.cardGroup}`}>
    <CardFace businessName={businessName} locationName={locationName} programType={programType} balance={balance} rewards={rewards} selected={selected} landed={landed} locale={locale} progress={false} business={false}>
      <section className={`customer-qr-panel ${styles.ticket}`} aria-label={t.codeHeading}>
        {qrSrc ? <div className={`customer-qr ${styles.qr}`}><Image unoptimized src={qrSrc} alt={t.qrAlt} width={220} height={220} priority /></div> : <p className={styles.missingQr}>{t.missingQr}</p>}
        {cardLocator ? <p className={`customer-card-number ${styles.locator}`}><span>{t.cardNumber}</span><strong>{cardLocator}</strong><small>{t.cardNumberHint}</small></p> : null}
        {readyCount > 0 ? <p className={styles.ticketNote}>{t.showToRedeem}</p> : null}
      </section>
    </CardFace>
    {props.onRefresh ? <div className={styles.refresh}>
      <Button variant="quiet" size="sm" icon={<RefreshCw size={16} />} onClick={props.onRefresh} loading={props.refreshing}>{props.refreshing ? t.refreshing : t.refresh}</Button>
      {props.refreshFailed ? <p className={styles.alert} role="alert">{t.refreshFailed}</p> : null}
    </div> : null}
    </div>


    {notices}

    <Extras items={extras({ t, happyHourUntil, pointsExpiry, challenge, level })} label={t.more} />

    {news ? <section className={styles.panel} aria-labelledby="customer-news-title">
      <h2 id="customer-news-title" className={styles.panelTitle}>{t.news}</h2>
      <p className={styles.rules}>{news}</p>
    </section> : null}

    <Wallet {...props} t={t} />

    {rewards.length > 1 ? <section className={styles.panel} aria-labelledby="customer-rewards-title">
      <h2 id="customer-rewards-title" className={styles.panelTitle}>{t.chooseReward}</h2>
      <div role="group" aria-label={t.rewardsGroup} className={styles.rewardList}>
        {rewards.map((reward) => <button key={reward.id} type="button" aria-pressed={selected?.id === reward.id} className={styles.rewardRow} onClick={() => setSelectedId(reward.id)}>
          <span className={styles.rewardText}><strong>{reward.title}</strong><small>{number.format(reward.cost)} {unit}</small></span>
          <Badge tone={balance >= reward.cost ? "success" : "neutral"}>{balance >= reward.cost ? t.redeemable : t.short(number.format(reward.cost - balance))}</Badge>
        </button>)}
      </div>
    </section> : null}

    {reviewUrl ? <p className={styles.links}><a href={reviewUrl} target="_blank" rel="noopener noreferrer">{t.review}</a></p> : null}

    {contactPanel}

    <ReturnSteps t={t} cardLocator={cardLocator} />

    <section className={`customer-activity ${styles.panel}`} aria-labelledby="customer-activity-title">
      <h2 id="customer-activity-title" className={styles.panelTitle}><History size={18} aria-hidden="true" /> {t.activity}</h2>
      {activity.length ? <ul className={`customer-activity-list ${styles.activity}`}>{activity.map((item) => <li key={item.id}><span><strong>{item.label}</strong><small>{item.date}</small></span><b data-sign={item.change > 0 ? "plus" : item.change < 0 ? "minus" : undefined}>{item.change > 0 ? "+" : ""}{item.change} {unit}</b></li>)}</ul> : <p className={styles.muted}>{t.activityEmpty}</p>}
    </section>

    {rulesText || pointsExpiry || challenge || level ? <section className={styles.panel} aria-labelledby="customer-rules-title">
      <h2 id="customer-rules-title" className={styles.panelTitle}>{t.rules}</h2>
      {rulesText ? <p className={styles.rules}>{rulesText}</p> : null}
      {pointsExpiry ? <p className={styles.rules}>{pointsExpiry.rule}</p> : null}
      {pointsExpiry?.batches.length ? <><p className={styles.rules}>{t.expiryList}</p><ul className={styles.rules}>{pointsExpiry.batches.map(line => <li key={line}>{line}</li>)}</ul></> : null}
      {challenge ? <p className={styles.rules}>{t.challenge}: {challenge.conditions}</p> : null}
      {level ? <p className={styles.rules}>{t.levelRule}</p> : null}
      <p className={styles.links}><a href="/teilnahmebedingungen">{t.terms}</a><a href="/datenschutz">{t.privacy}</a></p>
    </section> : null}

    {exportUrl ? <div className={styles.export}><CustomerExportLink url={exportUrl} locale={locale}>{t.export}</CustomerExportLink></div> : null}
    {props.onCloseCard ? <CloseCard {...props} t={t} /> : null}
  </CustomerShell></CardStatusProvider>;
}

/** The one progress statement: how many are missing for which reward, or which reward is ready. */
function Goal({ t, number, programType, balance, selected, readyCount, nextGoal }: { t: Copy; number: Intl.NumberFormat; programType: "stamps" | "points"; balance: number; selected?: Reward; readyCount: number; nextGoal?: Reward }) {
  if (!selected) return null;
  const unitFor = (n: number) => (programType === "points" ? (n === 1 ? t.point : t.points) : t.stamps);
  const remaining = Math.max(0, selected.cost - balance);
  const sub = remaining > 0 ? (readyCount === 1 ? t.readyOne : readyCount > 1 ? t.readyMany(readyCount) : null)
    : readyCount > 1 ? t.readyMany(readyCount) : nextGoal ? t.nextGoal(number.format(nextGoal.cost - balance), unitFor(nextGoal.cost - balance), nextGoal.title) : null;
  return <div className={styles.goal}>
    <p className={`reward-remaining ${styles.goalLine}`}>{remaining === 0 ? t.readyFor
      : <>{t.still} <NumberRoll value={remaining} className={styles.goalNum}>{number.format(remaining)}</NumberRoll> {t.toReward(unitFor(remaining))}</>} <span className={`goal-reward ${styles.rewardName}`}>{selected.title}</span></p>
    {sub ? <p className={styles.goalSub}>{sub}</p> : null}
  </div>;
}

type Extra = { key: string; line: string; block: ReactNode };

/**
 * Time-bound extras, nearest deadline first (Head of Design, 23 Oct): a happy hour running now ends today, the expiry
 * notice covers the next 30 days, the challenge ends with the month, the level runs 90 days. The first one present is shown in full; the rest fold into one quiet list,
 * so a card never stacks four panels. Their fine print lives in the programme rules.
 */
function extras({ t, happyHourUntil, pointsExpiry, challenge, level }: Pick<CustomerCardProps, "happyHourUntil" | "pointsExpiry" | "challenge" | "level"> & { t: Copy }): Extra[] {
  const items: Extra[] = [];
  if (happyHourUntil) items.push({ key: "happy", line: t.happyHour(happyHourUntil), block: <p className={styles.highlight}>{t.happyHour(happyHourUntil)}</p> });
  if (pointsExpiry?.notice) items.push({ key: "expiry", line: pointsExpiry.notice, block: <p className={styles.highlight} role="status">{pointsExpiry.notice}</p> });
  if (challenge) {
    const progress = challenge.done ? t.challengeDone : t.challengeProgress(challenge.visits, challenge.target);
    items.push({ key: "challenge", line: `${t.challenge}: ${challenge.done ? t.challengeDoneShort : progress}`, block: <section className={styles.panel} aria-labelledby="customer-challenge-title">
      <h2 id="customer-challenge-title" className={styles.panelTitle}>{t.challenge}</h2>
      <p className={styles.rules}>{challenge.text}</p>
      <p className={styles.rules}><strong>{progress}</strong></p>
    </section> });
  }
  if (level) {
    const title = level.name ? t.levelTitle(level.name) : t.noLevel;
    items.push({ key: "level", line: level.perk ? `${title} · ${level.perk}` : title, block: <section className={styles.panel} aria-labelledby="customer-level-title">
      <h2 id="customer-level-title" className={styles.panelTitle}>{title}</h2>
      {level.name && level.until ? <p className={styles.rules}><strong>{t.levelUntil(level.name, level.until)}</strong>{t.levelUntilRest}</p> : null}
      {level.perk ? <p className={styles.rules}>{t.perk(level.perk)}</p> : null}
      <p className={styles.rules}>{level.next ? t.levelNext(level.next.visits, level.next.name) : t.levelTop}</p>
    </section> });
  }
  return items;
}

function Extras({ items, label }: { items: Extra[]; label: string }) {
  const [first, ...rest] = items;
  if (!first) return null;
  return <>
    {first.block}
    {rest.length ? <ul className={styles.moreList} aria-label={label}>{rest.map(item => <li key={item.key}>{item.line}</li>)}</ul> : null}
  </>;
}

function Wallet({ onAppleWallet, onGoogleWallet, walletBusy = null, googleTestOnly, walletPlatform = "other", walletError, locale = "de", t }: CustomerCardProps & { t: Copy }) {
  // Platform only orders and narrows what is shown; the server decides availability.
  const apple = onAppleWallet && walletPlatform !== "android" ? [{ id: "apple" as const, label: t.addApple, onClick: onAppleWallet }] : [];
  const google = onGoogleWallet && walletPlatform !== "ios" ? [{ id: "google" as const, label: t.addGoogle, onClick: onGoogleWallet }] : [];
  const buttons = walletPlatform === "android" ? [...google, ...apple] : [...apple, ...google];
  if (!buttons.length) return null;
  return <section className={`customer-wallet-add ${styles.wallet}`} aria-labelledby="customer-wallet-title">
    <h2 id="customer-wallet-title" className={styles.panelTitle}>{t.walletTitle}</h2>
    <p className={styles.muted}>{t.walletIntro}</p>
    <div className={styles.walletButtons}>{buttons.map((button) => <button key={button.id} type="button" className={`wallet-add wallet-add--${button.id} ${styles.walletButton}`} onClick={button.onClick} disabled={walletBusy !== null} aria-busy={walletBusy === button.id} aria-label={walletBusy === button.id ? t.walletLoading : button.label}>
      {button.id === "google" ? <Image unoptimized src={`/wallet/google-add-${locale}.svg`} alt={button.label} width={199} height={55} /> : <span>{walletBusy === button.id ? t.walletLoading : button.label}</span>}
    </button>)}</div>
    {googleTestOnly && google.length ? <p className={`wallet-mode-note ${styles.muted}`}>{t.googleDemo}</p> : null}
    {walletError ? <p className={`wallet-error ${styles.alert}`} role="alert">{walletError}</p> : null}
  </section>;
}

function ReturnSteps({ t, cardLocator }: { t: Copy; cardLocator?: string }) {
  const { text: status, live, announce: setStatus } = useCardStatus("return");
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(new URL(window.location.pathname, window.location.origin).href);
      setStatus(t.copied);
    } catch { setStatus(t.copyFailed); }
  }
  return <section className={`customer-wallet ${styles.panel}`} aria-labelledby="customer-return-title">
    <h2 id="customer-return-title" className={styles.panelTitle}>{t.save}</h2>
    <ol className={`customer-return-steps ${styles.steps}`}>
      <li>{t.stepBookmark}</li>
      <li>{t.stepScanAgain}</li>
      {cardLocator ? <li>{t.stepNumber(cardLocator)}</li> : null}
    </ol>
    <p className={styles.muted}>{t.linkWarning}</p>
    <Button variant="secondary" size="sm" onClick={copyLink}>{t.copyLink}</Button>
    <CardStatusLine text={status} live={live} className={styles.muted} />
  </section>;
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
