import { Check } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { NumberRoll } from "@/components/ui/number-roll";
import { PointsLadder } from "@/components/ui/points-ladder";
import { STAMP_GRID_MAX, StampGrid, stampsLabel } from "@/components/ui/stamp-grid";
import { cx } from "@/components/ui/cx";
import { keepUnits, unitWord, withUnit, type UnitKind } from "@/lib/units";
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
/** Thumbnail columns: the card's while four rows hold them, then 5, then 6. Up to 12 stamps the dots are 8 px, from 13 they are 6 px. */
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
  title?: string; /** A node only at the till: a finished visit's warning line (Design r3). */ sub?: ReactNode;
  /** A label under the balance (the Kasse); „von 8“ then stands beside the figure. */
  label?: string;
  /** The page's own foot, in place of the voice's (the Kasse's pill and state). */
  foot?: ReactNode;
  /** The owner's line names this reward when it is not the grid's (a ready reward below the goal, Design #300). */
  lineReward?: CardReward;
  /** Points only, forwarded to the ladder: the balance before a booking just shown (crossed markers press), and the fill growing on the first paint. */
  landedFrom?: number; grow?: boolean;
  locale?: "de" | "fr"; className?: string;
};

/**
 * The mix card (founder's mix, 17 Nov, ruling 1): one drawing in every place. The shop's colour, mark and name left, the
 * balance right, the stamps in rows (earned coral with a check, open a dim disc), a hairline, then the foot. Colours come
 * from the merchant palette on an ancestor. Stamps are a share of their slot rounded to a whole pixel.
 */
export function MixCard({ businessName, locationName, programType, balance, reward, rewards, size = "full", voice = "guest", title, sub, label, foot, lineReward, landedFrom, grow, locale = "de", className }: Props) {
  const goal = reward.cost, have = Math.max(0, Math.min(balance, goal)), left = goal - have;
  const points = programType === "points", stamps = !points && goal <= STAMP_GRID_MAX;
  // Above the goal the card never clamps its count (Design, 18 Nov: one screen, one number): the grid shows all stamps
  // earned and the figure and its label give the true count with the unit.
  const over = !points && balance > goal;
  // The Kasse card keeps the 8-stamp card's height (Design, 18 Nov): above 8 the stamps go in two rows of ceil(goal / 2),
  // and from 9 columns an earned stamp is a plain coral disc. The guest card and the Kartenseite keep the mock's grid.
  const kasseCols = size === "kasse" && goal > 8 ? Math.ceil(goal / 2) : mixColumns(goal), plain = size === "kasse" && kasseCols >= 9;
  const said = over ? withUnit(balance, programType, locale) : stampsLabel(have, goal, locale), aria = size === "kasse" ? keepUnits(said) : said, cols = { "--cols": kasseCols } as CSSProperties;
  const tc = thumbColumns(goal);
  if (size === "thumb") return <span className={cx(styles.thumb, className)} style={{ "--cols": tc } as CSSProperties} data-five={(goal <= 12 && tc === 5) || undefined} data-dense={goal > 12 || undefined} role="img" aria-label={points ? withUnit(balance, "points", locale) : aria}>
    {stamps ? Array.from({ length: goal }, (_, i) => <i key={i} data-on={i < have || undefined} />) : null}
  </span>;
  const t = copyFor(locale), number = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "de-DE");
  const shown = points || over ? balance : have;
  const figure = <NumberRoll value={shown}>{number.format(shown)}</NumberRoll>, of = points || over ? t.unit(balance, programType) : `von ${goal}`;
  const body = foot ?? (size === "kasse" ? null : voice === "owner" ? <p className={styles.line}>{progressLine(balance, lineReward ?? reward, programType)}</p>
    : size === "example" ? <div className={styles.fields}><span><small>Prämie</small><strong>{reward.title}</strong></span><span><small>Einlösbar ab</small><strong>{withUnit(goal, programType, "de", "dat")}</strong></span></div>
    : <><p className={styles.line}>{left ? `${t.still} ${number.format(left)} ${t.toReward(t.unit(left, programType))}` : t.readyFor}</p><p className={styles.reward}>{reward.title}</p></>);
  return <section className={cx(styles.card, size === "kasse" && styles.kasse, className)} aria-label={size === "full" && voice === "guest" ? t.cardLabel : "Karte"}>
    <div className={styles.top}>
      <span className={styles.mark} aria-hidden="true">{[...businessName][0]}</span>
      <div className={styles.id}><b>{title ?? businessName}</b><span>{sub ?? locationName}</span></div>
      <div className={styles.n}>{label ? <><b data-figure="">{figure}<small>{"\u00a0"}{of}</small></b><span>{label}</span></> : <><b data-figure="">{figure}</b><span>{of}</span></>}</div>
    </div>
    {points ? <PointsLadder balance={balance} rewards={rewards ?? [reward]} landedFrom={landedFrom} grow={grow} tone="mix" locale={locale} titles keepUnits={size === "kasse"} />
      : !stamps ? <StampGrid earned={balance} total={goal} locale={locale} keepUnits={size === "kasse"} />
      : <div className={styles.stamps} style={cols} data-rows={Math.ceil(goal / kasseCols)} role="img" aria-label={aria}>
        {Array.from({ length: goal }, (_, i) => <span key={i} className={styles.stamp} data-on={i < have || undefined}>{i < have && !plain ? <Check size={size === "kasse" ? 26 : 22} aria-hidden="true" /> : null}</span>)}
      </div>}
    {body ? <div className={styles.foot}>{body}</div> : null}
  </section>;
}
