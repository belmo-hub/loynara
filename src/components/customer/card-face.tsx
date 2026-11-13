import { Gift } from "lucide-react";
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
export function CardFace({ businessName, locationName, programType, balance, rewards, selected, landed, landedCount, locale = "de", progress = true, business = true, tag, grow, className, children }: {
  businessName: string; locationName: string; programType: "stamps" | "points"; balance: number; rewards: CardReward[];
  /** The reward the progress line refers to. */
  selected?: CardReward;
  /** The stamp count that was just reached; the last `landedCount` stamps (one unless said) play the landing motion once. */
  landed?: number; landedCount?: number; locale?: "de" | "fr";
  /** The line to the selected reward; the guest's card page states it once, above the card, and passes false. */
  progress?: boolean;
  /** The shop's name on the card, as on the pass the cashier sees; false shows only the location when it differs. */
  business?: boolean;
  /** The card's level (Bronze, Silber, Gold) in the top corner; the guest's page shows its ready band instead of the ready tag. */
  tag?: string; className?: string; children?: ReactNode;
  /** The ladder fill (or a long programme's track) grows from the start: the guest card page's first paint, and nowhere else. */
  grow?: boolean;
}) {
  const t = copyFor(locale);
  const number = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "de-DE");
  const readyCount = rewards.filter((reward) => balance >= reward.cost).length;
  const remaining = selected ? Math.max(0, selected.cost - balance) : 0;
  return <section className={cx("customer-card", styles.object, className)} aria-label={t.cardLabel} data-ready={readyCount > 0 || undefined}>
    <div className={styles.objectTop}>
      <p className={`customer-card-business ${styles.business}`}>{business ? <strong>{businessName}</strong> : null}{business || locationName !== businessName ? <span>{locationName}</span> : null}</p>
      {tag ? <span className={styles.levelTag}>{tag}</span> : readyCount > 0 && progress ? <span className={styles.readyTag}>{t.readyTag}</span> : null}
    </div>
    {programType === "points" ? <p className={`customer-balance-line ${styles.pointsLead}`}><strong><NumberRoll value={balance}>{number.format(balance)}</NumberRoll> <em>{t.unit(balance, programType)}</em></strong></p> : null}
    {programType === "stamps" && selected
      ? <StampGrid earned={balance} total={selected.cost} landed={landed} landedCount={landedCount} locale={locale} reward={<Gift size={22} />} className={styles.stamps} grow={grow} />
      : <PointsLadder balance={balance} rewards={rewards} landedFrom={landed === undefined ? undefined : landed - (landedCount ?? 1)} locale={locale} titles className={styles.ladder} grow={grow} />}
    {programType === "stamps" && selected ? <p className={`customer-balance-line ${styles.balanceLine}`}><span><Gift size={20} aria-hidden="true" />{selected.title}</span><strong>{t.of(number.format(Math.min(balance, selected.cost)), number.format(selected.cost))}</strong></p> : null}
    {progress && selected ? <p className={`reward-remaining ${styles.remaining}`}>{remaining === 0 ? t.rewardReady : t.remaining(number.format(remaining), t.unit(remaining, programType), selected.title)}</p> : null}
    {children}
  </section>;
}
