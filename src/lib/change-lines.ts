import { withUnit, type UnitKind } from "./units";

/** „24.11.“: a calendar day (YYYY-MM-DD) as the card, the Wallet back and the owner's chips say it. */
export const cardDay = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;

type Reward = { title: string; cost: number };

/**
 * ENG-100: the card line for a reward change waiting for its date (Marketing W31 and W49 FINAL), the same on the customer
 * card, the join page, the Wallet back and the owner's preview. A higher cost with a new name says both.
 */
export function rewardChangeLine(type: UnitKind, now: Reward, change: { effectiveOn: string; title: string; cost: number } | { endsOn: string }) {
  if ("endsOn" in change) return `Ab ${cardDay(change.endsOn)} gibt es ${now.title} nicht mehr. Bis dahin kannst du die Prämie noch einlösen.`;
  const day = cardDay(change.effectiveOn);
  if (change.title !== now.title && change.cost !== now.cost)
    return `Ab ${day} gibt es „${change.title}“ für ${withUnit(change.cost, type)} statt „${now.title}“ für ${now.cost}. Bis dahin bleibt es bei der bisherigen Prämie.`;
  if (change.title !== now.title) return `Ab ${day} gibt es „${change.title}“ statt „${now.title}“. Bis dahin bleibt es bei der bisherigen Prämie.`;
  return `Ab ${day} gibt es ${now.title} für ${withUnit(change.cost, type)}. Bis dahin ${now.cost === 1 ? "reicht 1" : `reichen ${now.cost}`}.`;
}

/** A card line, and whether it ends in „Neue Regel lesen“ (a new text over 140 characters is not quoted, W46 v2). */
export type ChangeLine = { text: string; link?: boolean };
const QUOTE_MAX = 140;
const sentence = (text: string) => /[.!?…]$/.test(text) ? text : `${text}.`;
const perEuro = (n: number) => `${n} ${n === 1 ? "Punkt" : "Punkte"} pro 1 € Einkaufswert`;

/**
 * ENG-100: the card line for a rule change waiting for its date (Marketing W45, W46 v2, W52, W59 FINAL), the same on the
 * card, the join page, the Wallet back and the owner's preview. `before` and `after` are the rule in force and the waiting
 * one; `extras` says the shop earns by purchase amount, so the text holds its further rules only.
 */
export function ruleChangeLine(effectiveOn: string, before: { earningMode: string; pointsPerCurrencyUnit: number; rulesText: string }, after: { earningMode: string; pointsPerCurrencyUnit: number; rulesText: string },
  /** The Wallet back always quotes the whole new text (W46). */ full = false): ChangeLine {
  const day = cardDay(effectiveOn), text = after.rulesText.trim(), long = !full && text.length > QUOTE_MAX;
  if (before.earningMode === "manual" && after.earningMode === "purchase")
    return { text: `Ab ${day} gibt es ${perEuro(after.pointsPerCurrencyUnit)}. Bis dahin bleibt es bei der bisherigen Regel.` };
  const old = before.pointsPerCurrencyUnit, keeps = `bei ${old} ${old === 1 ? "Punkt" : "Punkten"} pro 1 € Einkaufswert`;
  if (before.earningMode === "purchase" && after.earningMode === "manual")
    return long ? { text: `Ab ${day} gilt eine neue Regel. Bis dahin bleibt es ${keeps}.`, link: true } : { text: `Ab ${day} gilt: ${sentence(text)} Bis dahin bleibt es ${keeps}.` };
  if (after.pointsPerCurrencyUnit !== old)
    return { text: `Ab ${day} gibt es ${after.pointsPerCurrencyUnit} ${after.pointsPerCurrencyUnit === 1 ? "Punkt" : "Punkte"} pro € Einkauf. Bis dahin bleibt es bei ${old}.` };
  // Weitere Regeln that were empty get a line of their own (CARD_LINE_EXTRA_ADDED).
  if (!before.rulesText.trim())
    return long ? { text: `Ab ${day} gilt eine weitere Regel. Bis dahin gilt sie noch nicht.`, link: true } : { text: `Ab ${day} gilt zusätzlich: ${sentence(text)} Bis dahin gilt das noch nicht.` };
  return long ? { text: `Ab ${day} gilt eine neue Regel. Bis dahin bleibt es bei der bisherigen.`, link: true } : { text: `Ab ${day} gilt: ${sentence(text)} Bis dahin bleibt es bei der bisherigen Regel.` };
}

/** ENG-100: the card line for a waiting expiry switch-on or shortening (Marketing W58 FINAL). */
export const expiryChangeLine = (effectiveOn: string, months: number) =>
  `Ab ${cardDay(effectiveOn)} verfallen neue Punkte nach ${months} Monaten. Punkte, die du bis dahin sammelst, verfallen nie.`;

type RuleState = { earningMode: string; pointsPerCurrencyUnit: number; rulesText: string };
type Waiting = {
  programType: "stamp" | "points";
  rewards: Array<Reward & { pending?: { effectiveOn: string; title: string; cost: number } | null; endsOn?: string | null }>;
  pending?: (RuleState & { effectiveOn: string; old: RuleState }) | null;
  pendingExpiry?: { effectiveOn: string; months: number } | null;
};

/**
 * Every change waiting for its date, as the customer reads it (ENG-100 U3): one line per reward, the rule's line with the
 * full new text behind „Neue Regel lesen“, and the expiry's line. The card lists them together; the join page puts each
 * after the text it changes; the Wallet back puts them first, in full.
 */
export function changeLines(program: Waiting, full = false) {
  const kind = program.programType === "points" ? "points" : "stamps", pending = program.pending, expiry = program.pendingExpiry;
  return {
    rewards: program.rewards.flatMap(reward => reward.endsOn ? [rewardChangeLine(kind, reward, { endsOn: reward.endsOn })] : reward.pending ? [rewardChangeLine(kind, reward, reward.pending)] : []),
    rule: pending ? ruleChangeLine(pending.effectiveOn, pending.old, pending, full) : undefined,
    newRule: pending?.rulesText.trim() ? { on: cardDay(pending.effectiveOn), text: pending.rulesText.trim() } : undefined,
    expiry: expiry ? expiryChangeLine(expiry.effectiveOn, expiry.months) : undefined,
  };
}

/** The lines in one list: rewards, the rule, the expiry (card page and Wallet back). */
export const waitingLines = (lines: ReturnType<typeof changeLines>) => [...lines.rewards, ...(lines.rule ? [lines.rule.text] : []), ...(lines.expiry ? [lines.expiry] : [])];

/** What the customer card shows (U3): every line under the card, and the whole new rule when its line only links to it. */
export function cardChanges(card: Waiting) {
  const lines = changeLines(card);
  return { lines: [...lines.rewards, ...(lines.rule ? [lines.rule] : []), ...(lines.expiry ? [lines.expiry] : [])], newRule: lines.rule?.link ? lines.newRule : undefined };
}
