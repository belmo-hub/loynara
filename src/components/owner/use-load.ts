"use client";

import { useCallback, useEffect, useState } from "react";
import { apiJson, ClientApiError } from "@/components/client-api";

export type Loadable<T> = { state: "idle" } | { state: "loading" } | { state: "ok"; data: T; at: number } | { state: "error"; message: string; status?: number };
type Stored<T> = { url: string; key: string; value: Loadable<T> };

/** GET with explicit loading / error / ok states. A failed read never turns into zero. Pass null to skip. */
export function useLoad<T>(url: string | null): [Loadable<T>, () => void] {
  const [store, setStore] = useState<Stored<T> | null>(null);
  const [tick, setTick] = useState(0);
  const key = url ? `${url}#${tick}` : null;
  useEffect(() => {
    if (!url || !key) return;
    let live = true;
    void apiJson<T>(url).then(data => { if (live) setStore({ url, key, value: { state: "ok", data, at: Date.now() } }); })
      .catch(cause => { if (live) setStore({ url, key, value: { state: "error", message: cause instanceof Error ? cause.message : "Die Daten konnten nicht geladen werden.", status: cause instanceof ClientApiError ? cause.status : undefined } }); });
    return () => { live = false; };
  }, [url, key]);
  const reload = useCallback(() => setTick(value => value + 1), []);
  let result: Loadable<T> = { state: "loading" };
  if (!url) result = { state: "idle" };
  else if (store?.key === key) result = store.value;
  else if (store?.url === url && store.value.state === "ok") result = store.value; // keep showing the last good value while refreshing
  return [result, reload];
}
