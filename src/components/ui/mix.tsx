import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "./cx";
import styles from "./mix.module.css";

/**
 * The founder's mix (17 Nov): page rhythm, panel, rows, section title, chips and buttons, as the approved mock's
 * mix.css draws them. Only mix screens use them; the house Card, Badge and Button keep their look.
 */
export const mixStyles = styles;

/** Blocks 16 apart; a MixSection in it stands 32 under the block before it. */
export function MixStack({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx(styles.stack, className)}>{children}</div>;
}

/** A titled section: the title 12 above its panels, an optional chip or link at the title's end, a note under them. */
export function MixSection({ title, aside, note, children }: { title: ReactNode; aside?: ReactNode; note?: ReactNode; children: ReactNode }) {
  const heading = <h2 className={styles.h}>{title}</h2>;
  return <section className={styles.sec}>
    {aside ? <div className={styles.secHead}>{heading}{aside}</div> : heading}
    {children}
    {note ? <p className={styles.note}>{note}</p> : null}
  </section>;
}

/** White, 1 px line, radius 20, no shadow. `pad` for free content; `head` is the panel's own title row. */
export function MixPanel({ pad, head, className, children }: { pad?: boolean; head?: ReactNode; className?: string; children: ReactNode }) {
  return <div className={cx(styles.panel, pad && styles.pad, className)}>{head ? <div className={styles.ph}>{head}</div> : null}{children}</div>;
}

/** The 40 px icon tile: green, coral (earned, ready) or muted. */
export function MixTile({ tone, children }: { tone?: "coral" | "mute"; children: ReactNode }) {
  return <span className={styles.tile} data-tone={tone} aria-hidden="true">{children}</span>;
}

/**
 * A row: 52 with one line, 64 with a sub line or a tile, 72 with the card thumbnail. The value and the chevron end on
 * the inset. With `href` the whole row is the link.
 */
export function MixRow({ icon, tone, thumb, title, sub, end, href }: { icon?: ReactNode; tone?: "coral" | "mute"; thumb?: ReactNode; title: ReactNode; sub?: ReactNode; end?: ReactNode; href?: string }) {
  const content = <>
    {thumb ?? (icon ? <MixTile tone={tone}>{icon}</MixTile> : null)}
    <div className={styles.body}>
      <span className={styles.text}><b>{title}</b>{sub ? <small>{sub}</small> : null}</span>
      {typeof end === "string" ? <span className={styles.val}>{end}</span> : end}
      {href ? <ChevronRight className={styles.chev} size={20} aria-hidden="true" /> : null}
    </div>
  </>;
  const lead = thumb ? "card" : icon ? "tile" : undefined;
  return href ? <Link href={href} className={styles.row} data-lead={lead}>{content}</Link> : <div className={styles.row} data-lead={lead}>{content}</div>;
}

export function MixChip({ warm, children }: { warm?: boolean; children: ReactNode }) {
  return <span className={cx(styles.chip, warm && styles.warm)}>{children}</span>;
}

/** Classes for a mix button on a <button> or a link: 44 high (lg 52), primary filled, quiet outlined. */
export const mixButton = ({ variant = "primary", lg, block }: { variant?: "primary" | "quiet"; lg?: boolean; block?: boolean } = {}) =>
  cx(styles.btn, styles[variant], lg && styles.lg, block && styles.block);
