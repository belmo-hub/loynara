import type { ReactNode } from "react";
import { PointsLadder } from "@/components/ui/points-ladder";
import { StampGrid } from "@/components/ui/stamp-grid";
import { cx } from "@/components/ui/cx";
import { NumberRoll } from "@/components/ui/number-roll";
import { copyFor } from "./customer-card-copy";
import styles from "./customer-card.module.css";

export type CardReward = { id: string; title: string; cost: number };

/** The reward the progress line refers to by default: the one with the fewest stamps or points still missing. */
export function nearestReward<T extends CardReward>(rewards: T[], balance: number): T | undefined {
  return [...rewards].sort((a, b) => Math.max(0, a.cost - balance) - Math.max(0, b.cost - balance) || a.cost - b.cost)[0];
}

/**
 * The card object itself, in the shop's colours: business, progress (stamps or points), balance and the line to the
 * next reward, with the code ticket passed in as children. The guest's card page and the owner's previews both use
 * it, so the owner sees exactly what guests see. Colours come from the merchant palette variables on an ancestor.
 */
export function CardFace({ businessName, locationName, programType, balance, rewards, selected, landed, locale = "de", className, children }: {
  businessName: string; locationName: string; programType: "stamps" | "points"; balance: number; rewards: CardReward[];
  /** The reward the progress line refers to. */
  selected?: CardReward;
  /** The stamp count that was just reached; that stamp plays the landing motion once. */
  landed?: number; locale?: "de" | "fr"; className?: string; children?: ReactNode;
}) {
  const t = copyFor(locale);
  const number = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "de-DE");
  const unit = programType === "points" ? t.points : t.stamps;
  const readyCount = rewards.filter((reward) => balance >= reward.cost).length;
  const remaining = selected ? Math.max(0, selected.cost - balance) : 0;
  return <section className={cx("customer-card", styles.object, className)} aria-label={t.cardLabel} data-ready={readyCount > 0 || undefined}>
    <div className={styles.objectTop}>
      <p className={`customer-card-business ${styles.business}`}><strong>{businessName}</strong><span>{locationName}</span></p>
      {readyCount > 0 ? <span className={styles.readyTag}>{t.readyTag}</span> : null}
    </div>
    {programType === "stamps" && selected
      ? <StampGrid earned={balance} total={selected.cost} landed={landed} locale={locale} className={styles.stamps} />
      : <PointsLadder balance={balance} rewards={rewards} locale={locale} className={styles.ladder} />}
    <div className={styles.balancePanel}>
      <p className={`customer-balance-line ${styles.balanceLine}`}><span>{t.balance}</span><strong><NumberRoll value={balance}>{number.format(balance)}</NumberRoll> <em>{unit}</em></strong></p>
      {selected ? <p className={`reward-remaining ${styles.remaining}`}>{remaining === 0 ? t.rewardReady : t.remaining(number.format(remaining), remaining === 1 && programType === "points" ? t.point : unit, selected.title)}</p> : null}
    </div>
    {children}
  </section>;
}
