import { useSyncExternalStore } from "react";

// The owner's „Kasse“ link opens the Kasse as a sheet over the app (ENG-256). It leaves the location's name here so the
// Kasse's loading frame names it from the first frame of the slide; only a fresh hand-off counts, so a reload or a
// stale tab falls back to „Kasse“ until the access check answers.
const KEY = "loynara_kasse_location";
const FRESH_MS = 10_000;

export function rememberKasseLocation(name: string | undefined) {
  try { if (name) sessionStorage.setItem(KEY, JSON.stringify({ name, at: Date.now() })); } catch { /* no storage: the frame says „Kasse“ */ }
  // React hides the page's root snapshot during a transition unless the root names itself; the sheet needs the old page
  // in view to dim it. The browser's own default name, set for this one navigation and given back after it.
  const root = document.documentElement;
  if (root.style.viewTransitionName === "") {
    root.style.viewTransitionName = "root";
    setTimeout(() => { if (root.style.viewTransitionName === "root") root.style.viewTransitionName = ""; }, 1_500);
  }
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
