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
