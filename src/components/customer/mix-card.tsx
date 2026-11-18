import { Check } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { PointsLadder } from "@/components/ui/points-ladder";
import { STAMP_GRID_MAX, StampGrid, stampsLabel } from "@/components/ui/stamp-grid";
import { cx } from "@/components/ui/cx";
import { unitWord, withUnit, type UnitKind } from "@/lib/units";
import type { CardReward } from "./card-face";
import { copyFor } from "./customer-card-copy";
import styles from "./mix-card.module.css";

const nf = new Intl.NumberFormat("de-DE");

/** The owner's neutral line under the stamps (R4), to the reward the guest's own card names, the title in quotes. */
export function progressLine(balance: number, reward: { title: string; cost: number }, kind: UnitKind) {
  const left = reward.cost - balance;
  return left <= 0 ? `Stand reicht für „${reward.title}“.` : `Noch ${nf.format(left)} ${unitWord(left, kind)} bis „${reward.title}“.`;
}

/** Columns as the mix draws them: 4 for 8 and 12, 5 for 10 and 15, 4 otherwise. */
export const mixColumns = (n: number) => n % 4 === 0 ? 4 : n % 5 === 0 ? 5 : 4;
/** Thumbnail columns: the card's while four rows hold them, then 5, then 6 with smaller dots, so up to 30 fit 64 × 44. */
export const thumbColumns = (n: number) => Math.ceil(n / mixColumns(n)) <= 4 ? mixColumns(n) : n <= 20 ? 5 : 6;

type Props = {
  businessName: string; locationName: string; programType: "stamps" | "points"; balance: number;
  /** The reward the card counts to: its cost is the number of stamps. */
  reward: CardReward;
  /** Points: the ladder's rewards (the programme's); the card keeps the house ladder, no stamp grid. */
  rewards?: CardReward[];
  /** full: guest card and Kartenseite; example: Programm's card with its two fields; kasse: the counter's card; thumb: 64 × 44 for list rows. */
  size?: "full" | "example" | "kasse" | "thumb";
  /** The full card's foot: the guest's line and reward, or the owner's neutral line. */
  voice?: "guest" | "owner";
  /** In place of the shop's name and location (the Kasse: the card number and its note). */
  title?: string; sub?: string;
  /** A label under the balance (the Kasse); „von 8“ then stands beside the figure. */
  label?: string;
  /** The page's own foot, in place of the voice's (the Kasse's pill and state). */
  foot?: ReactNode;
  locale?: "de" | "fr"; className?: string;
};

/**
 * The mix card (founder's mix, 17 Nov, ruling 1): one drawing in every place. The shop's colour, mark and name left, the
 * balance right, the stamps in rows (earned coral with a check, open a dim disc), a hairline, then the foot. Colours come
 * from the merchant palette on an ancestor. Stamps are a share of their slot rounded to a whole pixel.
 */
export function MixCard({ businessName, locationName, programType, balance, reward, rewards, size = "full", voice = "guest", title, sub, label, foot, locale = "de", className }: Props) {
  const goal = reward.cost, have = Math.max(0, Math.min(balance, goal)), left = goal - have;
  const points = programType === "points", stamps = !points && goal <= STAMP_GRID_MAX;
  const aria = stampsLabel(have, goal, locale), cols = { "--cols": mixColumns(goal) } as CSSProperties;
  const tc = thumbColumns(goal);
  if (size === "thumb") return <span className={cx(styles.thumb, className)} style={{ "--cols": tc } as CSSProperties} data-five={tc === 5 || undefined} data-dense={tc === 6 || undefined} role="img" aria-label={points ? withUnit(balance, "points", locale) : aria}>
    {stamps ? Array.from({ length: goal }, (_, i) => <i key={i} data-on={i < have || undefined} />) : null}
  </span>;
  const t = copyFor(locale), number = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "de-DE");
  const figure = number.format(points ? balance : have), of = points ? t.unit(balance, "points") : `von ${goal}`;
  const body = foot ?? (size === "kasse" ? null : voice === "owner" ? <p className={styles.line}>{progressLine(balance, reward, programType)}</p>
    : size === "example" ? <div className={styles.fields}><span><small>Prämie</small><strong>{reward.title}</strong></span><span><small>Einlösbar ab</small><strong>{withUnit(goal, programType, "de", "dat")}</strong></span></div>
    : <><p className={styles.line}>{left ? `${t.still} ${number.format(left)} ${t.toReward(t.unit(left, programType))}` : t.readyFor}</p><p className={styles.reward}>{reward.title}</p></>);
  return <section className={cx(styles.card, size === "kasse" && styles.kasse, className)} aria-label={size === "full" && voice === "guest" ? t.cardLabel : "Karte"}>
    <div className={styles.top}>
      <span className={styles.mark} aria-hidden="true">{[...businessName][0]}</span>
      <div className={styles.id}><b>{title ?? businessName}</b><span>{sub ?? locationName}</span></div>
      <div className={styles.n}>{label ? <><b>{figure}<small> {of}</small></b><span>{label}</span></> : <><b>{figure}</b><span>{of}</span></>}</div>
    </div>
    {points ? <PointsLadder balance={balance} rewards={rewards ?? [reward]} locale={locale} titles />
      : !stamps ? <StampGrid earned={have} total={goal} locale={locale} />
      : <div className={styles.stamps} style={cols} role="img" aria-label={aria}>
        {Array.from({ length: goal }, (_, i) => <span key={i} className={styles.stamp} data-on={i < have || undefined}>{i < have ? <Check size={size === "kasse" ? 26 : 22} aria-hidden="true" /> : null}</span>)}
      </div>}
    {body ? <div className={styles.foot}>{body}</div> : null}
  </section>;
}
