/** The booking moment on the card page: which bookings this device has not shown yet (design spec 2026-10-27-card-moment). */
export type ActivityEntry = { kind: string; delta: number; createdAt: string };

/** A card opened on a device for the first time celebrates only a booking this fresh, so a recovered card stays quiet. */
export const FIRST_OPEN_WINDOW_MS = 10 * 60_000;
/** The tap page shows its own moment and knows no booking time: bookings up to this long after its mark count as seen. */
export const TAP_MARK_SLACK_MS = 2 * 60_000;
/** The card shows the balance last seen for this long, then steps to the new one. */
export const MOMENT_STEP_MS = 420;
/** The stamp's landing (Pop in) takes --dur-reward. */
export const MOMENT_LAND_MS = 480;
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
 * storage nothing plays, because a reload could not tell that it already did. The server sends `stampMoment` only while
 * STAMP_ANIMATION_ENABLED is on (ENG-206): without it nothing plays and nothing is recorded.
 */
export function momentFor(read: { activity: ActivityEntry[]; balance: number; stampMoment?: object }, before: { balance: number | null; seenAt: string | null | undefined }, now: number) {
  if (!read.stampMoment) return { credited: 0, newest: null };
  const run = unseenAwards(read.activity, before.seenAt ?? null, now);
  const credited = before.balance === null
    ? (before.seenAt === undefined ? 0 : run.credited)
    : Math.max(0, Math.min(run.credited, read.balance - before.balance));
  return { credited, newest: run.newest };
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

/**
 * Where „Karte empfehlen“ stands (ENG-206). Without the server's field (flag off): in the panels below, as it always
 * did. With it: under the card group once the read brings the share (from the second team-confirmed booking on, in a
 * shop with referrals on), and otherwise nowhere, so it is neither rendered nor fetched. `awaited` (ENG-218): the block
 * became due on a timed re-read, which brings no share; it then stands shut in its place and asks for the share itself.
 */
export const referralPlace = (field: { referralDue: boolean; referral?: object } | undefined, awaited = false) => !field ? "below" as const : field.referral || (awaited && field.referralDue) ? "card" as const : null;
/**
 * ENG-218: the open card's timed re-reads bring no share (the server skips that transaction). While the block is due the
 * card keeps the share an earlier read brought, so the block neither vanishes nor asks again.
 */
export function keepShare<T extends { stampMoment?: { referralDue: boolean; referral?: object } }>(read: T, held: object | undefined): T {
  return read.stampMoment?.referralDue && !read.stampMoment.referral && held ? { ...read, stampMoment: { ...read.stampMoment, referral: held } } : read;
}
/** Due with a booking whose moment is playing, the block is held shut until the stamp has landed, then opens. */
export type ReferralHold = "none" | "held" | "released";
/** Only the visit whose booking is the second opens the block; on every later visit it stands in the first paint.
 * A block whose share is still on its way (`awaited`) is never "none": it opens once, when the share is there. */
export const referralHoldFor = (field: { referralNew: boolean } | undefined, moment: { stepped: boolean } | null, awaited = false): ReferralHold =>
  !moment || !field?.referralNew ? awaited ? "released" : "none" : moment.stepped ? "released" : "held";
