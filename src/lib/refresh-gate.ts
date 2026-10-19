/**
 * Coalesces "the page became visible again" refreshes. Returning to a tab usually fires focus and visibilitychange
 * together (and pageshow after a back navigation); the card must re-read its balance once, not three times, and never
 * more often than every `minIntervalMs` however often the guest switches apps.
 */
export function createRefreshGate(minIntervalMs: number, now: () => number = Date.now) {
  let inFlight = false;
  let last = Number.NEGATIVE_INFINITY;
  return {
    /** True when a refresh may start now; the caller must call finish() when it settles. */
    tryStart(): boolean {
      const time = now();
      if (inFlight || time - last < minIntervalMs) return false;
      inFlight = true;
      last = time;
      return true;
    },
    finish() { inFlight = false; },
    /** Records a load that happened outside the gate (the first page load), so an immediate focus does not repeat it. */
    markLoaded() { last = now(); },
  };
}

/** Automatic card reads one open card page may make in any 15 minutes (the server allows 90 per card, 240 per network). */
export const AUTO_REFRESH_BUDGET = 30;

/**
 * Delay before the next automatic re-read while the card is visible, or null to stop until the guest looks again:
 * every 5 s in the first 30 s after the card is shown (the stamp almost always lands then), every 20 s up to three
 * minutes, none after (13 reads). Each failed read in a row doubles the delay, up to a minute.
 */
export function nextAutoRefresh(shownForMs: number, failures: number, recentReads: number): number | null {
  if (recentReads >= AUTO_REFRESH_BUDGET) return null;
  const delay = Math.min((shownForMs < 30_000 ? 5_000 : 20_000) * 2 ** failures, 60_000);
  return shownForMs + delay > 180_000 ? null : delay;
}
