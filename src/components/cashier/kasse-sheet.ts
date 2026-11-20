import { useSyncExternalStore } from "react";

// The owner's „Kasse“ link opens the Kasse as a sheet over the app (ENG-256). It leaves the location's name here so the
// Kasse's loading frame names it from the first frame of the slide; only a fresh hand-off counts, so a reload or a
// stale tab falls back to „Kasse“ until the access check answers.
const KEY = "loynara_kasse_location";
const FRESH_MS = 10_000;

export function rememberKasseLocation(name: string | undefined) {
  try { if (name) sessionStorage.setItem(KEY, JSON.stringify({ name, at: Date.now() })); } catch { /* no storage: the frame says „Kasse“ */ }
}

/**
 * Whether the Kasse can arrive as a sheet right now: its route was prefetched and that prefetch is still inside the
 * router cache's window (router.prefetch keeps it for the static stale time, 5 minutes; 4.5 counts here). A cold start,
 * an offline tab or a stale prefetch go without the type and the Kasse fades in as on any entry, so the owner screen is
 * never held while the payload is still on its way. The transition stylesheet loads with the owner app.
 */
const FRESH_PREFETCH_MS = 270_000;
// When the last /cashier payload answered (ENG-304). The timeline's own list keeps only 250 entries and the owner app's
// prefetches fill it within a day; a newer payload is then missing from it, so an observer notes every one as well.
let kasseAnswered = 0;
let observer: PerformanceObserver | null | undefined;
const note = (entries: PerformanceEntryList) => {
  for (const entry of entries as PerformanceResourceTiming[]) {
    const url = new URL(entry.name, location.href);
    if (url.pathname === "/cashier" && url.searchParams.has("_rsc") && entry.responseEnd > 0) kasseAnswered = Math.max(kasseAnswered, entry.responseEnd);
  }
};
function watchKasse() {
  if (observer !== undefined) return;
  try { observer = new PerformanceObserver(list => note(list.getEntries())); observer.observe({ type: "resource", buffered: true }); }
  catch { observer = null; /* no observer: the Kasse fades in as on any entry */ }
}
// From the module's first load in the browser, before the owner screen's links prefetch anything.
if (typeof window !== "undefined") watchKasse();
export function kasseSheetReady() {
  // The browser hands entries to an observer a while after they land (those from before it started, later still), so a
  // tap right after the answer reads the list and the observer's queue too.
  try { note(performance.getEntriesByType("resource")); if (observer) note(observer.takeRecords()); } catch { return false; }
  return kasseAnswered > 0 && performance.now() - kasseAnswered < FRESH_PREFETCH_MS;
}

/** Prefetches the Kasse for the sheet, only while the tab is in view: a backgrounded tab warms it again when it returns. */
export function warmKasse(prefetch: (href: string) => void) {
  if (document.visibilityState === "visible") prefetch("/cashier");
}

/**
 * React hides the page's root snapshot during a transition unless the root names itself; the sheet needs the old page in
 * view to dim it. The browser's own default name is set for this navigation and given back when the transition ends
 * (kasseSheetEntered); the long timeout only covers a navigation that never ran one.
 */
export function holdRootForKasseSheet() {
  const root = document.documentElement;
  if (root.style.viewTransitionName !== "") return;
  root.style.viewTransitionName = "root";
  setTimeout(releaseRoot, 10_000);
}

function releaseRoot() {
  const root = document.documentElement;
  if (root.style.viewTransitionName === "root") root.style.viewTransitionName = "";
}

/** Called by the Kasse's layout when the sheet's enter animation starts: give the root its name back when it ends. */
export function kasseSheetEntered() {
  const running = document.getAnimations().filter(animation => (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition"));
  void Promise.allSettled(running.map(animation => animation.finished)).then(releaseRoot);
}

function read() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as { name?: string; at?: number } | null;
    return saved?.name && Date.now() - (saved.at ?? 0) < FRESH_MS ? saved.name : null;
  } catch { return null; }
}

const noSubscribe = () => () => {};
// Read once per mount; the server (and hydration) render the generic word.
export function useKasseLocation(fallback: string) {
  return useSyncExternalStore(noSubscribe, () => read() ?? fallback, () => fallback);
}
