"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiJson, ClientApiError, postJson, type MeResponse } from "@/components/client-api";
import { OwnerDialog } from "./owner-ui";

export type OwnerLocation = { id: string; name: string; city: string; programSlug: string | null; programName: string | null; programType: "stamp" | "points" | null; cards: number };
type Status = "loading" | "ready" | "unprovisioned" | "error";

type OwnerValue = {
  status: Status;
  me: MeResponse | null;
  error: string;
  locations: OwnerLocation[];
  switching: boolean;
  switchError: string;
  /** Bumps whenever the active location changes so location-scoped pages remount and refetch. */
  epoch: number;
  refresh: () => Promise<void>;
  reload: () => void;
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
  | { kind: "unprovisioned" }
  | { kind: "error"; message: string };

async function fetchAccount(): Promise<AccountResult> {
  try {
    const me = await apiJson<MeResponse>("/api/me");
    if (me.role === "cashier") return { kind: "cashier" };
    let locations: OwnerLocation[] = [];
    if (me.role === "owner") {
      try { locations = (await apiJson<{ locations: OwnerLocation[] }>("/api/merchant/locations")).locations; } catch { locations = []; }
    }
    return { kind: "ok", me, locations };
  } catch (cause) {
    if (cause instanceof ClientApiError && cause.status === 401) return { kind: "login" };
    if (cause instanceof ClientApiError && cause.status === 404) return { kind: "unprovisioned" };
    return { kind: "error", message: cause instanceof Error ? cause.message : "Dein Konto konnte nicht geladen werden." };
  }
}

export function OwnerProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<MeResponse | null>(null);
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
    if (result.kind === "unprovisioned") { setMe(null); setStatus("unprovisioned"); return; }
    if (kind === "silent") return; // keep the last known account instead of blanking the shell on a transient error
    setError(result.message); setStatus("error");
  }, [router]);
  const load = useCallback((kind: "initial" | "silent") => fetchAccount().then(result => apply(result, kind)), [apply]);

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

  const guard = useCallback((action: () => void) => {
    if (dirtyKeys.current.size === 0) { action(); return; }
    setPending(() => action);
  }, []);

  const switchLocation = useCallback((locationId: string) => {
    if (switching || locationId === me?.locationId) return;
    guard(() => {
      dirtyKeys.current.clear(); setDirtyCount(0);
      setSwitching(true); setSwitchError("");
      void postJson("/api/merchant/locations/select", { locationId }).then(async () => {
        setMe(null); // drop the previous location's identity immediately; nothing of it may stay on screen
        await load("silent");
        setEpoch(value => value + 1);
        setMessage("Standort gewechselt.");
      }).catch(cause => {
        setSwitchError(cause instanceof Error ? cause.message : "Der Standort konnte nicht gewechselt werden.");
        void load("silent");
      }).finally(() => setSwitching(false));
    });
  }, [guard, load, me?.locationId, switching]);

  const value = useMemo<OwnerValue>(() => ({
    status, me, error, locations, switching, switchError, epoch,
    refresh: () => load("silent"), reload: () => { setStatus("loading"); setError(""); void load("initial"); }, setDirty, guard, switchLocation, announce: setMessage,
  }), [status, me, error, locations, switching, switchError, epoch, load, setDirty, guard, switchLocation]);

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
