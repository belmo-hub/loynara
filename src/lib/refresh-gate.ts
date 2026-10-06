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
