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

/**
 * Automatic card reads (timed, focus and return) after which one open card page stops its timed re-reads for 15 minutes.
 * The server allows 90 reads per card, and per network (one shop Wi-Fi shares one address) 210 timed re-reads apart from
 * the 240 that page loads, returns, the refresh button and the tap page share.
 */
export const AUTO_REFRESH_BUDGET = 14;

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

/** timed: the window's own re-read (marked for the server's polling limit); return: focus, a real return or a back navigation. */
export type CardRead = "timed" | "return" | "button";
export type CardReadOutcome = "ok" | "grew" | "failed" | "stop" | "skipped";

/**
 * The open card's re-read window: from the card's first load and from each real return (visible after hidden, or a back
 * navigation) it re-reads on nextAutoRefresh's schedule while the page is visible, and ends when a read shows a grown
 * balance or the server refuses one. Focus and the button read once and leave the window as it is. One budget for the
 * page's lifetime, so returns don't buy new reads; a reload or a new tab starts a fresh one.
 */
export function createAutoRefresh(refresh: (read: CardRead) => Promise<CardReadOutcome>, visible: () => boolean) {
  let poll: ReturnType<typeof setTimeout> | undefined;
  let open = false, stopped = false, shownAt = 0, failures = 0;
  const reads: number[] = [];
  function schedule() {
    clearTimeout(poll);
    if (!open || stopped || !visible()) return;
    while (reads.length && Date.now() - reads[0] >= 15 * 60_000) reads.shift();
    const delay = nextAutoRefresh(Date.now() - shownAt, failures, reads.length);
    if (delay === null) open = false;
    else poll = setTimeout(() => void read("timed"), delay);
  }
  async function read(kind: CardRead) {
    const outcome = await refresh(kind);
    if (outcome === "skipped" && kind === "button") return;
    if (outcome !== "skipped" && kind !== "button") reads.push(Date.now());
    if (outcome === "grew" || outcome === "stop") open = false;
    failures = outcome === "failed" ? failures + 1 : outcome === "skipped" ? failures : 0;
    schedule();
  }
  function startWindow() { shownAt = Date.now(); failures = 0; open = true; }
  return {
    /** The card has loaded; the first window starts now, so its first re-read is not refused by the gate. */
    loaded() { startWindow(); schedule(); },
    visibility() {
      clearTimeout(poll);
      if (!visible()) return;
      startWindow();
      void read("return");
    },
    focus() { void read("return"); },
    button() { void read("button"); },
    stop() { stopped = true; clearTimeout(poll); },
  };
}
