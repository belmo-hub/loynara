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
export function kasseSheetReady() {
  try {
    const finished = performance.getEntriesByType("resource").filter(entry => {
      const url = new URL(entry.name, location.href);
      return url.pathname === "/cashier" && url.searchParams.has("_rsc") && (entry as PerformanceResourceTiming).responseEnd > 0;
    }).map(entry => (entry as PerformanceResourceTiming).responseEnd);
    return finished.length > 0 && performance.now() - Math.max(...finished) < FRESH_PREFETCH_MS;
  } catch { return false; }
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
