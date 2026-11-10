"use client";

import { Check } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { withUnit } from "@/lib/units";
import { cx } from "./cx";
import styles from "./points-ladder.module.css";

type Reward = { title: string; cost: number };
/** `titles`: each marker names its reward under the cost (the guest's card and the join preview, G-04). */
/** `landedFrom`: the balance before a booking just shown; every mark the booking crossed presses once, like a stamp. */
type Props = { balance: number; rewards: Reward[]; landedFrom?: number; locale?: "de" | "fr"; titles?: boolean; className?: string;
  /** The fill grows from the start, once (the guest card page's first paint); everywhere else it shows its value at once. */
  grow?: boolean; /** Said after the balance (the first page's promised Startbonus). */ note?: string };

const MIN_LABEL_GAP = 0.14;
/** Markers this close to the start align their labels to it (as the last one does to the end). */
const START_ALIGN = 0.25;
/** A name narrower than this is not worth showing; its cost stays (Design, 31 Oct). */
export const TITLE_FLOOR = 72;
/** The edge markers' labels may reach this far past the track's ends (the ladder's inset). */
const EDGE = 14;
const GAP = 8;
/** Half a price label's width under its marker. */
const PRICE = 12;
/** Before the page measures: about the track of a card on a 375 px phone, and Manrope 14/650's average letter. */
const DEFAULT_TRACK = 260;
const estimate = (title: string) => Math.ceil(Array.from(title).length * 7.6);

/**
 * Marker positions (0..1) and which cost labels to hide so neighbours never collide. The goal's (last) label always
 * shows: when it falls within the gap of earlier shown labels, those hide instead (Design, 31 Oct; their prices and
 * names stay in „Deine Prämien“).
 */
export function ladderMarks(sorted: Reward[], max: number, balance: number, gap = MIN_LABEL_GAP) {
  const marks = sorted.reduce<Array<Reward & { at: number; hideLabel: boolean; reached: boolean }>>((list, reward) => {
    const at = reward.cost / max;
    const lastShown = [...list].reverse().find((m) => !m.hideLabel);
    list.push({ ...reward, at, hideLabel: lastShown ? at - lastShown.at < gap : false, reached: balance >= reward.cost });
    return list;
  }, []);
  const goal = marks.at(-1);
  if (goal?.hideLabel) {
    goal.hideLabel = false;
    for (const m of marks.slice(0, -1)) if (goal.at - m.at < gap) m.hideLabel = true;
  }
  return marks;
}

const rank = (at: number) => (at === 1 ? 0 : at < START_ALIGN ? 1 : 2);

/**
 * How wide each reward name may be on a track `track` px wide, by need and priority (Design, 31 Oct): the goal (the last
 * marker) takes what it needs first and never yields, then the start-aligned name, then the middle ones from the right.
 * A name gets what it needs where that fits beside the names already placed, else the room left; below TITLE_FLOOR it
 * is hidden (null) and its cost stays. A middle name may slide sideways (`shift`) within its free stretch, as long as it
 * still sits under its marker. The ellipsis is the last resort, for a goal wider than the whole track. A price under
 * another reward's shown name is hidden too (`covered`), so no price reads as that name's; its dot stays.
 */
export function titleLayout(marks: Array<{ at: number; hideLabel: boolean }>, track: number, needs: number[]): { titles: Array<{ width: number; shift: number } | null>; covered: boolean[] } {
  const placed: Array<[number, number, number]> = [];
  const result: Array<{ width: number; shift: number } | null> = marks.map(() => null);
  const order = marks.map((_, i) => i).filter((i) => !marks[i].hideLabel).sort((a, b) => rank(marks[a].at) - rank(marks[b].at) || marks[b].at - marks[a].at);
  for (const i of order) {
    const { at } = marks[i], x = at * track;
    // A marker under a name already placed (the goal's, say) has no room of its own.
    if (placed.some(([l, r]) => l - GAP < x && x < r + GAP) && at !== 1) continue;
    const left = Math.max(-EDGE, ...placed.filter(([, r]) => r <= x).map(([, r]) => r + GAP));
    const right = Math.min(track + EDGE, ...placed.filter(([l]) => l >= x).map(([l]) => l - GAP));
    const room = at === 1 ? x + EDGE - left : at < START_ALIGN ? right - (x - EDGE) : right - left;
    const width = Math.max(0, Math.min(needs[i], room));
    if (at !== 1 && width < Math.min(needs[i], TITLE_FLOOR)) continue;
    // A middle name is centred under its marker, slid into its free stretch when it would touch a neighbour.
    const from = at === 1 ? x + EDGE - width : at < START_ALIGN ? x - EDGE : Math.min(Math.max(x - width / 2, left), right - width);
    const shift = at === 1 || at < START_ALIGN ? 0 : from - (x - width / 2);
    if (Math.abs(shift) > width / 2 - GAP) continue;
    result[i] = { width, shift };
    placed.push([from, from + width, i]);
  }
  const covered = marks.map((m, j) => m.at !== 1 && placed.some(([l, r, i]) => i !== j && l < m.at * track + PRICE && r > m.at * track - PRICE));
  return { titles: result, covered };
}

/** One track to the most expensive reward; a marker per reward becomes a pressed mark once affordable. */
export function PointsLadder({ balance, rewards, landedFrom, locale = "de", titles = false, className, grow = false, note }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<{ track: number; needs: number[] } | null>(null);
  const sorted = [...rewards].sort((a, b) => a.cost - b.cost);
  const key = sorted.map((r) => r.title).join("\u0000");
  // The names need the track's real width and their own: measured once here and again when the card resizes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!titles || !el) return;
    const context = document.createElement("canvas").getContext("2d");
    const measure = () => {
      const names = [...el.querySelectorAll<HTMLElement>("[data-title]")];
      const next = { track: el.clientWidth, needs: names.map((n) => {
        if (!context) return estimate(n.textContent ?? "");
        // Longhands: an engine may return the `font` shorthand empty.
        const style = getComputedStyle(n);
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        return Math.ceil(context.measureText(n.textContent ?? "").width) + 1;
      }) };
      setMeasured((last) => last && last.track === next.track && last.needs.join() === next.needs.join() ? last : next);
    };
    measure();
    // Names measured in the fallback font are too wide; measure again whenever a web font finishes loading.
    let live = true;
    void document.fonts?.ready.then(() => { if (live) measure(); });
    document.fonts?.addEventListener("loadingdone", measure);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // A text-size change at the same width (Safari's text zoom, a larger browser font) resizes the names, not the track.
    const name = el.querySelector("small");
    if (name) observer.observe(name);
    return () => { live = false; document.fonts?.removeEventListener("loadingdone", measure); observer.disconnect(); };
  }, [titles, key]);
  if (!rewards.length) return null;
  const max = Math.max(1, sorted.at(-1)?.cost ?? 1);
  const marks = ladderMarks(sorted, max, balance);
  const layout = titles ? titleLayout(marks, measured?.track ?? DEFAULT_TRACK, measured?.needs.length === marks.length ? measured.needs : marks.map((m) => estimate(m.title))) : null;
  const label = (locale === "fr" ? `${withUnit(balance, "points", "fr")} sur ${max}` : `${balance} von ${withUnit(max, "points", "de", "dat")}`) + (note ? `, ${note}` : "");
  return <div ref={ref} className={cx(styles.ladder, className)} role="img" aria-label={label} data-titles={titles || undefined} data-grow={grow || undefined}>
    <div className={styles.track}><span className={styles.fill} style={{ transform: `scaleX(${Math.min(1, balance / max)})` }} /></div>
    {marks.map((m, i) => <span key={`${m.title}-${m.cost}`} className={styles.mark} style={{ "--at": m.at } as CSSProperties} data-reached={m.reached || undefined} data-new={(m.reached && landedFrom !== undefined && m.cost > landedFrom) || undefined} data-label-hidden={m.hideLabel || undefined} data-price-hidden={layout?.covered[i] || undefined} data-end={m.at === 1 || undefined} data-start={m.at < START_ALIGN || undefined}>
      <span className={styles.dot}>{m.reached ? <Check size={14} strokeWidth={3} /> : null}</span>
      <small className={styles.cost}>{m.cost}</small>
      {titles ? <small className={styles.title} data-title style={{ "--room": `${layout?.titles[i]?.width ?? 0}px`, "--shift": `${layout?.titles[i]?.shift ?? 0}px` } as CSSProperties} data-title-hidden={!layout?.titles[i] || undefined}>{m.title}</small> : null}
    </span>)}
  </div>;
}
