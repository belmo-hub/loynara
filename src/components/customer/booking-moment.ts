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

/** Stored under the card number, not the private link token. Without storage (private mode) there is no record. */
export function readSeen(cardLocator: string) {
  try { return localStorage.getItem(key(cardLocator)); } catch { return null; }
}

/** Only ever moves forward. */
export function markSeen(cardLocator: string, iso: string) {
  try {
    const had = localStorage.getItem(key(cardLocator));
    if (!had || Date.parse(iso) > Date.parse(had)) localStorage.setItem(key(cardLocator), iso);
  } catch { /* no storage: a booking made while the card is open still plays, keyed on the balance growing */ }
}
