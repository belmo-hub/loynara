"use client";

import { Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { parsePurchaseAmountMinor, purchasePoints } from "@/lib/points";
import { apiJson, ClientApiError } from "./client-api";
import styles from "./cashier-tap-panel.module.css";
import { buttonClassName } from "./ui/button";
import { TextField } from "./ui/field";

export type TapPanelLocale = "de" | "fr";

/** One open NFC request. The server never sends a scan code; only the card number (cardLocator) is shown. */
export type PendingTapRequest = { id: string; createdAt: string; expiresAt: string; balance: number; cardLocator: string; expiresInMs?: number; ageMs?: number;
  /** What a points request needs for the cashier's entry, as a counter lookup returns it. */
  programType?: "stamp" | "points"; earningMode?: "manual" | "purchase"; pointsPerCurrencyUnit?: number; currency?: "EUR" | "MAD"; ruleVersionId?: string };
type TapAward = { quantity: number } | { purchaseAmountMinor: number; ruleVersionId: string };

/** The cashier's entry for a points request, read the way the counter reads it; null until it books at least one point. */
export function pointsEntry(item: PendingTapRequest, raw: string): { award: TapAward; points: number } | null {
  const value = raw.trim();
  if (item.earningMode !== "purchase") return /^[1-9]\d{0,5}$/.test(value) ? { award: { quantity: Number(value) }, points: Number(value) } : null;
  try {
    const amountMinor = parsePurchaseAmountMinor(value);
    return { award: { purchaseAmountMinor: amountMinor, ruleVersionId: item.ruleVersionId ?? "" }, points: purchasePoints(amountMinor, item.pointsPerCurrencyUnit ?? 1) };
  } catch { return null; }
}

/**
 * Re-anchors the server's timing to this phone's clock at the moment the list arrived. The server sends how long each
 * request has left and how old it is, so a phone whose clock is off still hides and counts down at the right time.
 */
export function anchorToLocalClock(item: PendingTapRequest, receivedAt: number): PendingTapRequest {
  if (typeof item.expiresInMs !== "number" || typeof item.ageMs !== "number") return item;
  return { ...item, expiresAt: new Date(receivedAt + item.expiresInMs).toISOString(), createdAt: new Date(receivedAt - item.ageMs).toISOString() };
}

type Outcome = { tone: "success" | "neutral" | "error"; text: string };

const POLL_MS = 2000;
const CLOCK_TICK_MS = 1000;
const REQUEST_TIMEOUT_MS = 8000;
/** How long a confirmed request stays on screen with its tick before it leaves the list. */
const DONE_MS = 900;
/** Dispatched on window by the page when a push arrives or the page becomes visible again (contract 7). */
export const TAP_REFRESH_EVENT = "loynara:tap-refresh";

const STRINGS: Record<TapPanelLocale, {
  title: string; empty: string; intro: string; offline: string; loadError: string;
  cardLabel: string; balanceLabel: string; ago: (seconds: number) => string; expires: (countdown: string) => string;
  confirm: string; done: string; reject: string; newRequest: string; signedOut: string;
  confirmed: (cardLocator: string, balance: string) => string;
  rejected: string; alreadyProcessed: string;
  expired: string; cooldown: string; forbidden: string; notFound: string; rateLimited: string; network: string; failed: string;
  introPoints: string; amount: (currency: string) => string; points: string; rate: (rate: number, currency: string) => string; book: string;
  preview: (points: number, balance?: number) => string;
  confirmedPoints: (cardLocator: string, balance: string) => string; cooldownPoints: string; limit: string; staleRule: string; otherEntry: string;
}> = {
  de: {
    title: "NFC-Anfragen",
    empty: "Keine offenen NFC-Anfragen",
    intro: "Einkauf prüfen, dann bestätigen.",
    offline: "Keine Verbindung. Angezeigt wird der letzte bekannte Stand. Die Liste aktualisiert sich, sobald du wieder online bist.",
    loadError: "Anfragen konnten gerade nicht geladen werden. Es wird erneut versucht.",
    cardLabel: "Kartennummer",
    balanceLabel: "Stand",
    ago: seconds => `vor ${seconds} s`,
    expires: countdown => `läuft ab in ${countdown}`,
    signedOut: "Du bist nicht mehr angemeldet. Bitte melde dich neu an, um NFC-Anfragen zu sehen.",
    confirm: "Stempel bestätigen",
    done: "Bestätigt",
    reject: "Ablehnen",
    newRequest: "Neue NFC-Anfrage eingegangen.",
    confirmed: (cardLocator, balance) => `Stempel für ${cardLocator} bestätigt. Neuer Stand: ${balance}.`,
    rejected: "Anfrage abgelehnt. Es wurde nichts gebucht.",
    alreadyProcessed: "Schon von jemand anderem bestätigt. Es wurde nichts doppelt gebucht.",
    expired: "Diese Anfrage ist abgelaufen. Bitte die Kundin oder den Kunden das NFC-Schild erneut berühren lassen.",
    cooldown: "Diese Karte hat gerade erst einen Stempel bekommen. Bitte noch nicht bestätigen.",
    forbidden: "Für diesen Standort fehlt dir die Berechtigung. Bitte die Geschäftsleitung fragen.",
    notFound: "Diese Anfrage ist nicht mehr offen. Die Liste wird gerade aktualisiert.",
    rateLimited: "Zu viele Versuche. Bitte kurz warten und dann erneut versuchen.",
    network: "Keine Verbindung. Die Anfrage ist vielleicht noch offen. Prüfe die Liste, bevor du sie erneut bestätigst.",
    failed: "Das hat nicht geklappt. Bitte versuche es erneut.",
    introPoints: "Betrag eintragen, Punkte prüfen, buchen.",
    amount: currency => `Kaufbetrag (${currency})`,
    points: "Punkte",
    rate: (rate, currency) => `${rate} ${rate === 1 ? "Punkt" : "Punkte"} pro 1 ${currency}, abgerundet.`,
    book: "Buchen",
    preview: (points, balance) => `+${points} ${points === 1 ? "Punkt" : "Punkte"}${balance === undefined ? "" : ` · Neuer Stand: ${balance}`}`,
    confirmedPoints: (cardLocator, balance) => `Punkte für ${cardLocator} gebucht. Neuer Stand: ${balance}.`,
    cooldownPoints: "Auf dieser Karte wurden gerade erst Punkte gebucht. Bitte noch nicht bestätigen.",
    limit: "Kaufbetrag oder Punkte überschreiten das Limit dieser Rolle. Bitte die Inhaberin oder den Inhaber zur Prüfung hinzuziehen.",
    staleRule: "Die Punkteregel hat sich geändert. Bitte den Betrag erneut prüfen.",
    otherEntry: "Schon mit einer anderen Eingabe bestätigt. Es wurde nichts doppelt gebucht.",
  },
  fr: {
    title: "Demandes NFC",
    empty: "Aucune demande NFC en attente",
    intro: "Vérifiez l’achat, puis confirmez.",
    offline: "Pas de connexion. La liste affiche la dernière mise à jour et se rafraîchit dès que la connexion revient.",
    loadError: "Les demandes n’ont pas pu être chargées. Nouvelle tentative en cours.",
    cardLabel: "Numéro de carte",
    balanceLabel: "Solde",
    ago: seconds => `il y a ${seconds} s`,
    expires: countdown => `expire dans ${countdown}`,
    signedOut: "Vous n’êtes plus connecté(e). Reconnectez-vous pour voir les demandes NFC.",
    confirm: "Confirmer le tampon",
    done: "Confirmé",
    reject: "Refuser",
    newRequest: "Nouvelle demande NFC reçue.",
    confirmed: (cardLocator, balance) => `Tampon confirmé pour ${cardLocator}. Nouveau solde : ${balance}.`,
    rejected: "Demande refusée. Rien n’a été enregistré.",
    alreadyProcessed: "Déjà confirmé par quelqu’un d’autre. Rien n’a été enregistré en double.",
    expired: "Cette demande a expiré. Demandez à la cliente ou au client de toucher à nouveau le panneau NFC.",
    cooldown: "Cette carte vient de recevoir un tampon. Ne confirmez pas encore.",
    forbidden: "Il manque l’autorisation pour cet établissement. Demandez-la à la direction.",
    notFound: "Cette demande n’est plus en attente. La liste se met à jour.",
    rateLimited: "Trop de demandes. Patientez un instant, puis réessayez.",
    network: "Pas de connexion. La demande est peut-être encore ouverte. Vérifiez la liste avant de la confirmer à nouveau.",
    failed: "L’action a échoué. Veuillez réessayer.",
    introPoints: "Saisissez le montant, vérifiez les points, enregistrez.",
    amount: currency => `Montant de l’achat (${currency})`,
    points: "Points",
    rate: (rate, currency) => `${rate} point(s) par 1 ${currency}, arrondi vers le bas.`,
    book: "Enregistrer",
    preview: (points, balance) => `+${points} point(s)${balance === undefined ? "" : ` · Nouveau solde : ${balance}`}`,
    confirmedPoints: (cardLocator, balance) => `Points enregistrés pour ${cardLocator}. Nouveau solde : ${balance}.`,
    cooldownPoints: "Cette carte vient de recevoir des points. Ne confirmez pas encore.",
    limit: "Le montant ou les points dépassent la limite de ce rôle. Demandez à la personne propriétaire de vérifier cet achat.",
    staleRule: "La règle de points a changé. Vérifiez le montant à nouveau.",
    otherEntry: "Déjà confirmé avec une autre saisie. Rien n’a été enregistré en double.",
  },
};

/** Whole seconds until expiry, rounded up so the countdown only reaches 0 once the request is gone. */
export function secondsLeft(expiresAt: string, now: number): number {
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires)) return 0;
  return Math.max(0, Math.ceil((expires - now) / 1000));
}

/** A request is open while its expiry lies in the future. Unparseable timestamps are never shown. */
export function isOpenRequest(item: Pick<PendingTapRequest, "expiresAt">, now: number): boolean {
  const expires = Date.parse(item.expiresAt);
  return Number.isFinite(expires) && expires > now;
}

/** Whole seconds since the tap; never negative, so a slightly skewed clock shows "vor 0 s". */
export function secondsSince(createdAt: string, now: number): number {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return 0;
  return Math.max(0, Math.floor((now - created) / 1000));
}

/** m:ss for a countdown. */
export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/** True when at least one id in nextIds was not in previousIds. The caller signals at most once per refresh. */
export function hasNewRequest(previousIds: ReadonlySet<string>, nextIds: readonly string[]): boolean {
  return nextIds.some(id => !previousIds.has(id));
}

export function tapErrorText(error: unknown, locale: TapPanelLocale = "de", points = false): string {
  const t = STRINGS[locale];
  if (error instanceof ClientApiError) {
    if (error.code === "TAP_EXPIRED") return t.expired;
    if (error.code === "TAP_COOLDOWN") return points ? t.cooldownPoints : t.cooldown;
    if (error.code === "LIMIT_EXCEEDED") return t.limit;
    if (error.code === "STALE_RULE" || error.code === "INVALID_EARNING_MODE") return t.staleRule;
    if (error.code === "KEY_REUSED") return t.otherEntry;
    if (error.code === "TAP_ALREADY_CONFIRMED") return t.alreadyProcessed;
    if (error.status === 403) return t.forbidden;
    if (error.status === 404) return t.notFound;
    if (error.status === 429) return t.rateLimited;
    if (error.status === 0) return t.network;
    return locale === "de" ? error.message : t.failed;
  }
  return error instanceof Error && locale === "de" ? error.message : t.failed;
}

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

/** Short beep plus vibration. Every step fails silently when audio is blocked or unsupported. */
function playAttentionSignal(audioRef: { current: AudioContext | null }) {
  try { navigator.vibrate?.(200); } catch { /* vibration unsupported */ }
  try {
    if (!audioRef.current) {
      const Context = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
      if (!Context) return;
      audioRef.current = new Context();
    }
    const ctx = audioRef.current;
    if (ctx.state === "suspended") { void ctx.resume().catch(() => undefined); return; }
    if (ctx.state !== "running") return;
    const start = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.32);
  } catch { /* audio blocked: stay silent */ }
}

type WakeLockSentinelLike = { readonly released?: boolean; release(): Promise<void> };
type WakeLockLike = { request(type: "screen"): Promise<WakeLockSentinelLike> };

/** Open NFC requests for this location. New taps appear on their own; the server decides every outcome. */
export function CashierTapPanel({ locale = "de", onPendingCountChange }: { locale?: TapPanelLocale; onPendingCountChange?: (count: number) => void }) {
  const t = STRINGS[locale];
  const [items, setItems] = useState<PendingTapRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [signedOut, setSignedOut] = useState<"signedOut" | "forbidden" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // Points requests: what the cashier typed per request; the preview under it shows what „Buchen“ books.
  const [entries, setEntries] = useState<Record<string, string>>({});
  // Requests the server just confirmed: the row stays for DONE_MS with its button swapped to a tick, then leaves.
  const [done, setDone] = useState<PendingTapRequest[]>([]);

  // Only the newest refresh may update the list, so a slow poll cannot bring back a request that was just confirmed.
  const refreshSeq = useRef(0);
  const loadingRef = useRef(false);
  // null until the first successful load, so requests that were already waiting when the page opened do not beep.
  const knownIdsRef = useRef<Set<string> | null>(null);
  const inFlightRef = useRef(new Set<string>());
  const audioRef = useRef<AudioContext | null>(null);
  const onCountRef = useRef(onPendingCountChange);

  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    loadingRef.current = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const received = await apiJson<PendingTapRequest[]>("/api/cashier/tap/pending", { signal: controller.signal });
      if (seq !== refreshSeq.current) return;
      const at = Date.now();
      const list = (Array.isArray(received) ? received : []).map(item => anchorToLocalClock(item, at));
      setItems(list);
      setNow(at);
      setOffline(false);
      setLoadFailed(false);
      setSignedOut(null);
      const previous = knownIdsRef.current;
      const openIds = list.filter(item => isOpenRequest(item, at)).map(item => item.id);
      if (previous && hasNewRequest(previous, openIds)) {
        playAttentionSignal(audioRef);
        setAnnouncement(t.newRequest);
      }
      knownIdsRef.current = new Set(list.map(item => item.id));
    } catch (error) {
      if (seq !== refreshSeq.current) return;
      // The last list stays on screen; only the notice changes.
      if (error instanceof ClientApiError && error.status === 0) setOffline(true);
      else if (error instanceof ClientApiError && (error.status === 401 || error.status === 403)) {
        // Signed out elsewhere or access withdrawn: nothing stays on screen that could be acted on.
        setItems([]); knownIdsRef.current = null; setSignedOut(error.status === 401 ? "signedOut" : "forbidden");
      }
      else setLoadFailed(true);
    } finally {
      clearTimeout(timer);
      if (seq === refreshSeq.current) { loadingRef.current = false; setLoaded(true); }
    }
  }, [t]);

  useEffect(() => {
    // Deferred by one tick so the first load does not set state synchronously inside the effect.
    const first = setTimeout(() => void refresh(), 0);
    const poll = setInterval(() => {
      if (document.visibilityState === "visible" && !loadingRef.current) void refresh();
    }, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const onPushOrVisible = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(TAP_REFRESH_EVENT, onPushOrVisible);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(TAP_REFRESH_EVENT, onPushOrVisible);
    };
  }, [refresh]);

  useEffect(() => { onCountRef.current = onPendingCountChange; }, [onPendingCountChange]);

  // Screen Wake Lock: keep the counter screen on while this panel is mounted and the page is visible.
  useEffect(() => {
    const wakeLock = (navigator as unknown as { wakeLock?: WakeLockLike }).wakeLock;
    if (!wakeLock) return;
    let active = true;
    let requesting = false;
    let sentinel: WakeLockSentinelLike | null = null;
    const acquire = async () => {
      if (!active || requesting || document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
      requesting = true;
      try {
        const next = await wakeLock.request("screen");
        if (!active) { void next.release().catch(() => undefined); return; }
        sentinel = next;
      } catch { /* unsupported, denied or hidden: fail silently */ }
      finally { requesting = false; }
    };
    const onVisibility = () => { if (document.visibilityState === "visible") void acquire(); };
    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibility);
      const current = sentinel;
      sentinel = null;
      if (current) void current.release().catch(() => undefined);
    };
  }, []);

  // Browsers only let audio start after a user gesture; resume a context that was created earlier.
  useEffect(() => {
    const unlock = () => {
      const ctx = audioRef.current;
      if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      const ctx = audioRef.current;
      audioRef.current = null;
      if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
    };
  }, []);

  const act = useCallback(async (item: PendingTapRequest, action: "confirm" | "cancel", award?: TapAward) => {
    if (inFlightRef.current.has(item.id)) return;
    inFlightRef.current.add(item.id);
    setBusyIds(current => new Set(current).add(item.id));
    setOutcome(null);
    const points = item.programType === "points";
    try {
      const result = await apiJson<{ state: string; balance?: number }>(`/api/cashier/tap/${encodeURIComponent(item.id)}/${action}`, award
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(award) } : { method: "POST" });
      if (action === "cancel") setOutcome({ tone: "neutral", text: t.rejected });
      else if (result.state === "confirmed") {
        setDone(current => [...current, item]);
        setTimeout(() => setDone(current => current.filter(entry => entry.id !== item.id)), DONE_MS);
        setOutcome({ tone: "success", text: (points ? t.confirmedPoints : t.confirmed)(item.cardLocator, typeof result.balance === "number" ? String(result.balance) : "–") });
      }
      else setOutcome({ tone: "neutral", text: t.alreadyProcessed });
    } catch (error) {
      const alreadyDone = error instanceof ClientApiError && (error.code === "TAP_ALREADY_CONFIRMED" || error.code === "KEY_REUSED");
      setOutcome({ tone: alreadyDone ? "neutral" : "error", text: tapErrorText(error, locale, points) });
    } finally {
      inFlightRef.current.delete(item.id);
      setBusyIds(current => { const next = new Set(current); next.delete(item.id); return next; });
      await refresh();
    }
  }, [locale, refresh, t]);

  const open = items.filter(item => isOpenRequest(item, now));
  const openCount = open.length;
  const shown = [...open, ...done.filter(item => !open.some(other => other.id === item.id))];

  useEffect(() => { onCountRef.current?.(openCount); }, [openCount]);

  return (
    <section className={styles.panel} aria-label={t.title}>
      <div className={styles.header}>
        <h2 className={styles.title}>{t.title}</h2>
        {openCount > 0 && <span className={styles.count}>{openCount}</span>}
        {loaded && openCount === 0 && <p className={styles.emptyInline}>{t.empty}</p>}
      </div>
      {offline && <p className={styles.notice} role="status">{t.offline}</p>}
      {!offline && loadFailed && <p className={styles.notice} role="status">{t.loadError}</p>}
      {signedOut && <p className={styles.notice} role="alert">{signedOut === "signedOut" ? t.signedOut : t.forbidden}</p>}
      {shown.length > 0 && <>
        <p className={styles.intro}>{open.some(item => item.programType === "points") ? t.introPoints : t.intro}</p>
        <ul className={styles.list}>
          {shown.map(item => {
            const confirmed = done.some(entry => entry.id === item.id);
            const busy = busyIds.has(item.id) || confirmed;
            const purchase = item.earningMode === "purchase";
            const entry = item.programType === "points" ? pointsEntry(item, entries[item.id] ?? "") : null;
            return <li key={item.id} className={styles.item}>
              <div className={styles.identity}>
                <span className={styles.cardLabel}>{t.cardLabel}</span>
                <strong className={styles.locator} translate="no">{item.cardLocator || "–"}</strong>
              </div>
              <div className={styles.meta}>
                <span>{t.balanceLabel}: <strong>{typeof item.balance === "number" ? item.balance : "–"}</strong></span>
                <span>{t.ago(secondsSince(item.createdAt, now))}</span>
                <span>{t.expires(formatCountdown(secondsLeft(item.expiresAt, now)))}</span>
              </div>
              {item.programType === "points" && <TextField id={`tap-entry-${item.id}`} label={purchase ? t.amount(item.currency ?? "EUR") : t.points}
                hint={purchase ? t.rate(item.pointsPerCurrencyUnit ?? 1, item.currency ?? "EUR") : undefined} inputMode={purchase ? "decimal" : "numeric"} autoComplete="off"
                placeholder={purchase ? "16,70" : "10"} value={entries[item.id] ?? ""} disabled={busy} onChange={event => { const value = event.target.value; setEntries(current => ({ ...current, [item.id]: value })); }} />}
              {entry && !confirmed && <p className={styles.preview} aria-live="polite">{t.preview(entry.points, typeof item.balance === "number" ? item.balance + entry.points : undefined)}</p>}
              <div className={styles.actions}>
                {item.programType === "points"
                  ? <button type="button" className={`${buttonClassName({ variant: "primary" })} ${styles.primary}`} data-done={confirmed || undefined} disabled={busy || !entry} onClick={() => { if (entry) void act(item, "confirm", entry.award); }}>{confirmed ? <Done label={t.done} /> : t.book}</button>
                  : <button type="button" className={`${buttonClassName({ variant: "primary" })} ${styles.primary}`} data-done={confirmed || undefined} disabled={busy} onClick={() => void act(item, "confirm")}>{confirmed ? <Done label={t.done} /> : t.confirm}</button>}
                {!confirmed && <button type="button" className={`${buttonClassName({ variant: "secondary" })} ${styles.secondary}`} disabled={busy} onClick={() => void act(item, "cancel")}>{t.reject}</button>}
              </div>
            </li>;
          })}
        </ul>
      </>}
      {outcome && <p role="status" className={`${styles.outcome} ${outcome.tone === "success" ? styles.outcomeSuccess : outcome.tone === "error" ? styles.outcomeError : styles.outcomeNeutral}`}>{outcome.text}</p>}
      <p className={styles.srOnly} aria-live="polite">{announcement}</p>
    </section>
  );
}

/** The confirm button's label after the server confirmed: a tick that draws in, swapped in place of the action. */
function Done({ label }: { label: string }) {
  return <span className={styles.done}><Check size={20} aria-hidden="true" />{label}</span>;
}
