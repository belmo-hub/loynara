import { Gift } from "lucide-react";
import type { ReactNode } from "react";
import { PointsLadder } from "@/components/ui/points-ladder";
import { StampGrid } from "@/components/ui/stamp-grid";
import { cx } from "@/components/ui/cx";
import { NumberRoll } from "@/components/ui/number-roll";
import { copyFor } from "./customer-card-copy";
import styles from "./card-face.module.css";

export type CardReward = { id: string; title: string; cost: number };

/** The reward the progress line refers to by default: the one with the fewest stamps or points still missing. */
export function nearestReward<T extends CardReward>(rewards: T[], balance: number): T | undefined {
  return [...rewards].sort((a, b) => Math.max(0, a.cost - balance) - Math.max(0, b.cost - balance) || a.cost - b.cost)[0];
}

/**
 * The reward the card's grid counts to (Design, 18 Nov, #285 ruling b): the cheapest one the balance has not reached
 * yet; once every reward is reached, the largest (the card then reads the true count). A ready reward below it is
 * redeemed from the band and the list. The Kasse counts the same way.
 */
export function cardGoal<T extends CardReward>(rewards: T[], balance: number): T | undefined {
  const byCost = [...rewards].sort((a, b) => a.cost - b.cost);
  return byCost.find(reward => reward.cost > balance) ?? byCost.at(-1);
}

/**
 * The card object itself, in the shop's colours: business, progress (stamps or points), balance and the line to the
 * next reward, with the code ticket passed in as children. The guest's card page and the owner's previews both use
 * it, so the owner sees exactly what guests see. Colours come from the merchant palette variables on an ancestor.
 */
export function CardFace({ businessName, locationName, programType, balance, rewards, selected, landed, landedCount, locale = "de", progress = true, business = true, tag, grow, label, goal = selected, className, children }: {
  businessName: string; locationName: string; programType: "stamps" | "points"; balance: number; rewards: CardReward[];
  /** The reward the progress line refers to. */
  selected?: CardReward;
  /** The reward the stamp grid counts to, when it is not the line's (cardGoal: a ready reward below it is named first). */
  goal?: CardReward;
  /** The stamp count that was just reached; the last `landedCount` stamps (one unless said) play the landing motion once. */
  landed?: number; landedCount?: number; locale?: "de" | "fr";
  /** The line to the selected reward; the guest's card page states it once, above the card, and passes false. */
  progress?: boolean;
  /** The shop's name on the card, as on the pass the cashier sees; false shows only the location when it differs. */
  business?: boolean;
  /** The card's level (Bronze, Silber, Gold) in the top corner; the guest's page shows its ready band instead of the ready tag. */
  tag?: string; className?: string; children?: ReactNode;
  /** The region's name; the guest's voice unless an owner preview names it as the example („Karte“). */
  label?: string;
  /** The ladder fill (or a long programme's track) grows from the start: the guest card page's first paint, and nowhere else. */
  grow?: boolean;
}) {
  const t = copyFor(locale);
  const number = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "de-DE");
  const readyCount = rewards.filter((reward) => balance >= reward.cost).length;
  const remaining = selected ? Math.max(0, selected.cost - balance) : 0;
  return <section className={cx("customer-card", styles.object, className)} aria-label={label ?? t.cardLabel} data-ready={readyCount > 0 || undefined}>
    <div className={styles.objectTop}>
      <p className={`customer-card-business ${styles.business}`}>{business ? <strong>{businessName}</strong> : null}{business || locationName !== businessName ? <span>{locationName}</span> : null}</p>
      {tag ? <span className={styles.levelTag}>{tag}</span> : readyCount > 0 && progress ? <span className={styles.readyTag}>{t.readyTag}</span> : null}
    </div>
    {programType === "points" ? <p className={`customer-balance-line ${styles.pointsLead}`}><strong><NumberRoll value={balance}>{number.format(balance)}</NumberRoll> <em>{t.unit(balance, programType)}</em></strong></p> : null}
    {programType === "stamps" && goal
      ? <StampGrid earned={balance} total={goal.cost} landed={landed} landedCount={landedCount} locale={locale} reward={<Gift size={22} />} className={styles.stamps} grow={grow} />
      : <PointsLadder balance={balance} rewards={rewards} landedFrom={landed === undefined ? undefined : landed - (landedCount ?? 1)} locale={locale} titles className={styles.ladder} grow={grow} />}
    {programType === "stamps" && goal ? <p className={`customer-balance-line ${styles.balanceLine}`}><span><Gift size={20} aria-hidden="true" />{goal.title}</span><strong>{/* Never clamped (Design, 18 Nov): above the goal the true count with its unit. */}{balance > goal.cost ? `${number.format(balance)} ${t.unit(balance, "stamps")}` : t.of(number.format(balance), number.format(goal.cost))}</strong></p> : null}
    {progress && selected ? <p className={`reward-remaining ${styles.remaining}`}>{remaining === 0 ? (goal && goal.id !== selected.id ? `${t.readyFor} ${selected.title}` : t.rewardReady) : t.remaining(number.format(remaining), t.unit(remaining, programType), selected.title)}</p> : null}
    {children}
  </section>;
}
