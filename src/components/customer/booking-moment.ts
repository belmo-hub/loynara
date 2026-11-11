/** The booking moment on the card page: which bookings this device has not shown yet (design spec 2026-10-27-card-moment). */
export type ActivityEntry = { kind: string; delta: number; createdAt: string };

/** A card opened on a device for the first time celebrates only a booking this fresh, so a recovered card stays quiet. */
export const FIRST_OPEN_WINDOW_MS = 10 * 60_000;
/** The tap page shows its own moment and knows no booking time: bookings up to this long after its mark count as seen. */
export const TAP_MARK_SLACK_MS = 2 * 60_000;
/** The card shows the balance last seen for this long, then steps to the new one. */
export const MOMENT_STEP_MS = 420;
export const MOMENT_PILL_MS = 6000;

/**
 * What the newest bookings added since `seenAt`. `activity` comes newest first; the run ends at the first entry that is
 * not a booking, because below a redemption or correction the balance is no longer "the old balance plus bookings".
 */
export function unseenAwards(activity: ActivityEntry[], seenAt: string | null, now: number) {
  const since = seenAt ? Date.parse(seenAt) : now - FIRST_OPEN_WINDOW_MS;
  let credited = 0;
  for (const entry of activity) {
    if (entry.kind !== "award" || entry.delta <= 0 || !(Date.parse(entry.createdAt) > since)) break;
    credited += entry.delta;
  }
  return { credited, newest: activity[0]?.createdAt ?? null };
}

const key = (cardLocator: string) => `loynara_seen:${cardLocator}`;

/** Stored under the card number, not the private link token. `null`: nothing recorded yet. `undefined`: storage is blocked (private mode). */
export function readSeen(cardLocator: string): string | null | undefined {
  try { return localStorage.getItem(key(cardLocator)); } catch { return undefined; }
}

/**
 * What one read of the card may celebrate. Only bookings this device has not shown count, so a correction or an undone
 * redemption (the balance grows, but no booking was made) plays nothing. While the card is open the moment never claims
 * more than the balance grew. On the first read there is no balance to compare: the record decides alone, and without
 * storage nothing plays, because a reload could not tell that it already did.
 */
export function momentFor(read: { activity: ActivityEntry[]; balance: number }, before: { balance: number | null; seenAt: string | null | undefined }, now: number) {
  const run = unseenAwards(read.activity, before.seenAt ?? null, now);
  const credited = before.balance === null
    ? (before.seenAt === undefined ? 0 : run.credited)
    : Math.max(0, Math.min(run.credited, read.balance - before.balance));
  return { credited, newest: run.newest };
}

// ENG-205: the join page showed a card being created (and, with a Startbonus, its places landing), then opened the
// card page. That first read is a return: nothing is celebrated a second time. The mark is a time in this page's
// memory: it outlives the soft change to the card page, but not a reload or another tab, names no card and holds no
// card link (ENG-214). It counts for a few seconds.
export const JOINED_WINDOW_MS = 15_000;
let joinedAt = 0;
const fresh = (now: number) => joinedAt > 0 && now - joinedAt >= 0 && now - joinedAt < JOINED_WINDOW_MS;
export function markJoined(now = Date.now()) { joinedAt = now; }
/** The card page's paint before its first read: asks without using the mark up. */
export function peekJoined(now = Date.now()) { return fresh(now); }
/** The first read: true once, then the mark is gone. */
export function takeJoined(now = Date.now()) {
  if (!fresh(now)) return false;
  joinedAt = 0;
  return true;
}

/** The later of two marks, either of which may be missing. */
export const laterMark = (a: string | null | undefined, b: string | null | undefined) => (a && b ? (Date.parse(a) >= Date.parse(b) ? a : b) : a ?? b ?? null);

/** Only ever moves forward. */
export function markSeen(cardLocator: string, iso: string) {
  try {
    const had = localStorage.getItem(key(cardLocator));
    if (!had || Date.parse(iso) > Date.parse(had)) localStorage.setItem(key(cardLocator), iso);
  } catch { /* no storage: a booking made while the card is open still plays, keyed on the balance growing */ }
}
