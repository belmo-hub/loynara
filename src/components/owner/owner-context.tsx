"use client";

import type { PilotSurface } from "@/lib/pilot-surfaces";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiJson, ClientApiError, postJson, type EndedAccountResponse, type MeResponse } from "@/components/client-api";
import { accountLoadMessage, locationSwitchMessage, SETUP_INCOMPLETE } from "./owner-errors";
import { OwnerDialog } from "./owner-ui";

export type OwnerLocation = { id: string; name: string; city: string; timezone?: string; programSlug: string | null; programName: string | null; programType: "stamp" | "points" | null; cards: number };
type NavigateEventLike = { navigationType: string; cancelable: boolean; destination: { key: string }; preventDefault: () => void };
type NavigationLike = { addEventListener: (type: string, listener: EventListener) => void; removeEventListener?: (type: string, listener: EventListener) => void; traverseTo?: (key: string) => { committed?: Promise<unknown> } };
type Status = "loading" | "ready" | "unprovisioned" | "ended" | "error";
export type EndedInfo = EndedAccountResponse["programEnded"];
/** What the operator entered for a shop it created, shown in the assistant until the owner confirms or changes it. */
export type SetupDraft = { businessName: string; locationName: string; city: string; country: string; timezone: string; locale: string };

type OwnerValue = {
  /** Surfaces withheld on this deployment, known even before an account has a merchant (see lib/pilot-surfaces). */
  hiddenSurfaces: readonly PilotSurface[];
  status: Status;
  me: MeResponse | null;
  /** Set when the shop's programme has ended: the owner area is then only the export. */
  ended: EndedInfo | null;
  setupDraft: SetupDraft | null;
  error: string;
  locations: OwnerLocation[];
  switching: boolean;
  switchError: string;
  /** Bumps whenever the active location changes so location-scoped pages remount and refetch. */
  epoch: number;
  refresh: () => Promise<boolean>;
  reload: () => void;
  resetAfterSignOut: () => void;
  setDirty: (key: string, dirty: boolean) => void;
  /** Runs `action` now, or after the merchant confirms discarding unsaved edits. */
  guard: (action: () => void) => void;
  switchLocation: (locationId: string) => void;
  announce: (message: string) => void;
};

const OwnerContext = createContext<OwnerValue | null>(null);
export function useOwner() {
  const value = useContext(OwnerContext);
  if (!value) throw new Error("useOwner must be used inside OwnerProvider");
  return value;
}

/** Registers unsaved edits for as long as `dirty` is true; leaving the page clears it. */
export function useDirtyGuard(key: string, dirty: boolean) {
  const { setDirty } = useOwner();
  useEffect(() => { setDirty(key, dirty); return () => setDirty(key, false); }, [key, dirty, setDirty]);
}

type AccountResult =
  | { kind: "ok"; me: MeResponse; locations: OwnerLocation[] }
  | { kind: "cashier" }
  | { kind: "login" }
  | { kind: "unprovisioned"; draft: SetupDraft | null }
  | { kind: "ended"; info: EndedInfo }
  | { kind: "error"; message: string };

async function fetchAccount(): Promise<AccountResult> {
  try {
    const me = await apiJson<MeResponse | EndedAccountResponse | { userId: string; tenantId: null; publicBaseUrl: string; setupDraft?: SetupDraft | null }>("/api/me");
    if ("programEnded" in me) return me.programEnded.role === "cashier" ? { kind: "cashier" } : { kind: "ended", info: me.programEnded };
    if (me.tenantId === null) return { kind: "unprovisioned", draft: "setupDraft" in me ? me.setupDraft ?? null : null }; // identity-only account, explicitly confirmed by the server
    if (!me.locationId || !me.programSlug || !["owner", "manager", "cashier"].includes(me.role)) {
      return { kind: "error", message: SETUP_INCOMPLETE };
    }
    if (me.role === "cashier") return { kind: "cashier" };
    let locations: OwnerLocation[] = [];
    if (me.role === "owner") {
      try { locations = (await apiJson<{ locations: OwnerLocation[] }>("/api/merchant/locations")).locations; } catch { locations = []; }
    }
    return { kind: "ok", me, locations };
  } catch (cause) {
    if (cause instanceof ClientApiError && cause.status === 401) return { kind: "login" };
    return { kind: "error", message: accountLoadMessage(cause) };
  }
}

export function OwnerProvider({ children, hiddenSurfaces = [] }: { children: ReactNode; hiddenSurfaces?: readonly PilotSurface[] }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [ended, setEnded] = useState<EndedInfo | null>(null);
  const [setupDraft, setSetupDraft] = useState<SetupDraft | null>(null);
  const [error, setError] = useState("");
  const [locations, setLocations] = useState<OwnerLocation[]>([]);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const [epoch, setEpoch] = useState(0);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<null | (() => void)>(null);
  const dirtyKeys = useRef(new Set<string>());
  const [dirtyCount, setDirtyCount] = useState(0);

  const apply = useCallback((result: AccountResult, kind: "initial" | "silent") => {
    if (result.kind === "cashier") { router.replace("/cashier"); return; }
    if (result.kind === "login") { router.replace("/login"); return; }
    if (result.kind === "ok") { setMe(result.me); setLocations(result.locations); setStatus("ready"); return; }
    if (result.kind === "unprovisioned") { setMe(null); setSetupDraft(result.draft); setStatus("unprovisioned"); return; }
    if (result.kind === "ended") { setMe(null); setEnded(result.info); setStatus("ended"); return; }
    if (kind === "silent") return; // keep the last known account instead of blanking the shell on a transient error
    setError(result.message); setStatus("error");
  }, [router]);
  const load = useCallback((kind: "initial" | "silent") => fetchAccount().then(result => { apply(result, kind); return result.kind === "ok"; }), [apply]);

  const resetAfterSignOut = useCallback(() => {
    dirtyKeys.current.clear(); setDirtyCount(0); setPending(null);
    setMe(null); setLocations([]); setStatus("loading");
  }, []);

  useEffect(() => {
    let live = true;
    void fetchAccount().then(result => { if (live) apply(result, "initial"); });
    return () => { live = false; };
  }, [apply]);

  const setDirty = useCallback((key: string, dirty: boolean) => {
    const keys = dirtyKeys.current;
    if (dirty) keys.add(key); else keys.delete(key);
    setDirtyCount(keys.size);
  }, []);

  useEffect(() => {
    if (dirtyCount === 0) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyCount]);

  // Browser Back/Forward: Next's router offers no supported way to veto a history traversal, and history
  // sentinel hacks fight its own history bookkeeping. Where the Navigation API exists (Chromium), a cancelable
  // "traverse" event is intercepted while edits are unsaved; elsewhere Back is not guarded (see docs).
  const traversalBypass = useRef(false);
  useEffect(() => {
    if (dirtyCount === 0) return;
    const nav = (window as unknown as { navigation?: NavigationLike }).navigation;
    if (!nav?.addEventListener) return;
    const onNavigate = ((event: NavigateEventLike) => {
      if (traversalBypass.current || event.navigationType !== "traverse" || !event.cancelable) return;
      event.preventDefault();
      const key = event.destination.key;
      setPending(() => () => {
        dirtyKeys.current.clear(); setDirtyCount(0);
        traversalBypass.current = true;
        const result = nav.traverseTo?.(key);
        const release = () => { traversalBypass.current = false; };
        if (result?.committed) void result.committed.then(release, release); else release();
      });
    }) as unknown as EventListener;
    nav.addEventListener("navigate", onNavigate);
    return () => nav.removeEventListener?.("navigate", onNavigate);
  }, [dirtyCount]);

  const guard = useCallback((action: () => void) => {
    if (dirtyKeys.current.size === 0) { action(); return; }
    setPending(() => action);
  }, []);

  const switchLocation = useCallback((locationId: string) => {
    if (switching || locationId === me?.locationId) return;
    guard(() => {
      dirtyKeys.current.clear(); setDirtyCount(0);
      setSwitching(true); setSwitchError(""); setMessage("");
      void postJson("/api/merchant/locations/select", { locationId }).then(async () => {
        setMe(null); // drop the previous location's identity immediately; nothing of it may stay on screen
        const result = await fetchAccount();
        apply(result, "initial"); // selection has no valid old context to preserve on failure
        if (result.kind === "ok") {
          setEpoch(value => value + 1);
          setMessage("Standort gewechselt.");
        }
      }).catch(cause => {
        setSwitchError(locationSwitchMessage(cause));
        void load("silent");
      }).finally(() => setSwitching(false));
    });
  }, [apply, guard, load, me?.locationId, switching]);

  const value = useMemo<OwnerValue>(() => ({
    hiddenSurfaces, status, me, ended, setupDraft, error, locations, switching, switchError, epoch,
    refresh: () => load("silent"), reload: () => { setStatus("loading"); setError(""); void load("initial"); }, resetAfterSignOut, setDirty, guard, switchLocation, announce: setMessage,
  }), [hiddenSurfaces, status, me, ended, setupDraft, error, locations, switching, switchError, epoch, load, resetAfterSignOut, setDirty, guard, switchLocation]);

  return (
    <OwnerContext.Provider value={value}>
      {children}
      <div className="ow-sr" role="status" aria-live="polite" aria-atomic="true">{message}</div>
      {pending && (
        <OwnerDialog title="Ungespeicherte Änderungen verwerfen?" onClose={() => setPending(null)}
          actions={<>
            <button type="button" className="ow-btn ow-btn--secondary" data-autofocus onClick={() => setPending(null)}>Weiter bearbeiten</button>
            <button type="button" className="ow-btn ow-btn--danger" onClick={() => { const run = pending; setPending(null); run(); }}>Änderungen verwerfen</button>
          </>}>
          <p>Diese Seite enthält Änderungen, die noch nicht gespeichert wurden. Wenn du jetzt weitergehst, gehen sie verloren.</p>
        </OwnerDialog>
      )}
    </OwnerContext.Provider>
  );
}
