// Points expiry (ENG-051): the pure rules. No database, so client code may import it.

/** The periods an owner can choose; off is the default. */
export const POINTS_EXPIRY_MONTHS = [6, 12, 24] as const;
/** The card and the Wallet reminder look this many days ahead; a card gets at most one reminder per such window. */
export const EXPIRY_REMINDER_DAYS = 30;

/** The rule as the customer reads it on the card from the first visit (Legal: known before collecting). */
export function expiryRuleText(months: number) {
  return `Punkte verfallen ${months} Monate nach dem Sammeln, die ältesten zuerst.`;
}

/** Same day of the month `months` later; a day the target month lacks becomes its last day (31 Aug + 6 months = 28/29 Feb). */
export function addMonths(at: Date, months: number) {
  const target = new Date(at);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(at.getUTCDate(), lastDay));
  return target;
}

export type ExpiryLedgerRow = { delta: number; kind: string; createdAt: Date };
export type ExpiryBucket = { amount: number; expiresAt: Date };

/**
 * Points still on the card that can expire, oldest first. Replays the card's ledger in time order: every positive row
 * (an award, or a correction that gives points back) is a lot earned at its time; every negative row uses up the oldest
 * lots first; an expiry row uses up the lots that were due when it was booked. Only lots earned since the rule started
 * get an expiry date, so points collected before the customer could know the rule never expire.
 */
export function expiryBuckets(rows: ExpiryLedgerRow[], rule: { months: number; since: Date }): ExpiryBucket[] {
  const lots: Array<{ amount: number; expiresAt: Date | null }> = [];
  const consume = (amount: number, eligible: (lot: { expiresAt: Date | null }) => boolean) => {
    for (const lot of lots) {
      if (amount === 0) break;
      if (lot.amount === 0 || !eligible(lot)) continue;
      const used = Math.min(lot.amount, amount);
      lot.amount -= used;
      amount -= used;
    }
    return amount;
  };
  for (const row of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (row.delta > 0) lots.push({ amount: row.delta, expiresAt: row.createdAt >= rule.since ? addMonths(row.createdAt, rule.months) : null });
    else if (row.kind === "expiry") consume(consume(-row.delta, lot => lot.expiresAt !== null && lot.expiresAt <= row.createdAt), () => true);
    else consume(-row.delta, () => true);
  }
  return lots.filter((lot): lot is ExpiryBucket => lot.amount > 0 && lot.expiresAt !== null);
}

/** What the expiry job books now: every lot whose date has passed. */
export function duePoints(buckets: ExpiryBucket[], now: Date) {
  const due = buckets.filter(lot => lot.expiresAt <= now);
  return { amount: due.reduce((sum, lot) => sum + lot.amount, 0), lastExpiresAt: due.at(-1)?.expiresAt };
}

/** Points that expire within the next EXPIRY_REMINDER_DAYS, and when the first of them goes. */
export function upcomingExpiry(buckets: ExpiryBucket[], now: Date) {
  const until = new Date(now.getTime() + EXPIRY_REMINDER_DAYS * 86_400_000);
  const soon = buckets.filter(lot => lot.expiresAt > now && lot.expiresAt <= until);
  return soon.length ? { amount: soon.reduce((sum, lot) => sum + lot.amount, 0), firstAt: soon[0].expiresAt } : null;
}

/** „Ab dem 15.11.2026 verfallen 80 Punkte auf deiner Karte. Löse sie vorher ein.“ (Wallet reminder and card line). */
export function expiryReminderText(amount: number, firstAt: Date, timeZone: string) {
  const day = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone }).format(firstAt);
  return amount === 1 ? `Ab dem ${day} verfällt 1 Punkt auf deiner Karte. Löse ihn vorher ein.` : `Ab dem ${day} verfallen ${amount} Punkte auf deiner Karte. Löse sie vorher ein.`;
}
