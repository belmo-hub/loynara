"use client";

import { useCallback, useEffect, useState } from "react";
import { apiJson, ClientApiError } from "./client-api";

type Pending = { id: string; createdAt: string; expiresAt: string; scanCode: string; balance: number };
const POLL_MS = 5000;

export function tapErrorText(error: unknown): string {
  if (error instanceof ClientApiError) {
    if (error.code === "TAP_EXPIRED") return "Diese Anfrage ist abgelaufen. Die Kundin oder der Kunde berührt das Schild einfach erneut.";
    if (error.code === "TAP_COOLDOWN") return "Diese Karte hat gerade erst einen Stempel bekommen. Bitte noch nicht bestätigen.";
    if (error.code === "TAP_ALREADY_CONFIRMED") return "Diese Anfrage wurde schon bestätigt.";
    if (error.status === 403) return "Für diesen Standort fehlt die Berechtigung.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Aktion fehlgeschlagen.";
}

/** Open NFC requests for this location. New taps appear on their own; the server decides every outcome. */
export function CashierTapPanel() {
  const [pending, setPending] = useState<Pending[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try { setPending(await apiJson<Pending[]>("/api/cashier/tap/pending")); setOffline(false); }
    catch { setOffline(true); }
    finally { setLoaded(true); }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const poll = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const wake = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", wake);
    return () => { clearTimeout(first); clearInterval(poll); clearInterval(tick); document.removeEventListener("visibilitychange", wake); };
  }, [refresh]);

  async function act(id: string, action: "confirm" | "cancel") {
    setBusy(id); setMessage("");
    try {
      const result = await apiJson<{ state: string; balance?: number }>(`/api/cashier/tap/${encodeURIComponent(id)}/${action}`, { method: "POST" });
      setMessage(action === "cancel" ? "Anfrage abgelehnt. Es wurde nichts gebucht." : result.state === "confirmed" ? `Ein Stempel bestätigt. Neuer Stand: ${result.balance}.` : "Diese Anfrage war bereits bestätigt.");
    } catch (error) { setMessage(tapErrorText(error)); }
    finally { setBusy(null); await refresh(); }
  }

  const open = pending.filter(item => new Date(item.expiresAt).getTime() > now);
  return (
    <section aria-labelledby="tap-pending-heading" style={{ maxWidth: 760, margin: "24px auto", padding: 24 }}>
      <h2 id="tap-pending-heading">NFC-Anfragen{open.length > 0 && <span aria-label={`${open.length} offen`} style={{ marginLeft: 8, padding: "2px 10px", borderRadius: 999, background: "#e8f1ec", fontSize: 14 }}>{open.length}</span>}</h2>
      <p>Wenn Kundinnen und Kunden das NFC-Schild berühren, erscheint die Anfrage hier. Prüfe den Einkauf an der Kasse, bevor du einen Stempel bestätigst.</p>
      {offline && <p role="alert">Keine Verbindung. Neue Anfragen erscheinen wieder, sobald du online bist.</p>}
      {loaded && !offline && open.length === 0 && <p className="ow-muted">Keine offenen Anfragen. Neue erscheinen hier automatisch.</p>}
      {open.map(item => {
        const seconds = Math.max(0, Math.round((new Date(item.expiresAt).getTime() - now) / 1000));
        return (
          <div key={item.id} style={{ padding: 16, marginTop: 12, border: "1px solid #c6d5ca", borderRadius: 12 }}>
            <strong>Karte {item.scanCode}</strong>
            <p>Stand: {item.balance} · läuft ab in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="button button--accent" type="button" disabled={busy !== null} onClick={() => void act(item.id, "confirm")}>Einen Stempel bestätigen</button>
              <button className="button button--outline" type="button" disabled={busy !== null} onClick={() => void act(item.id, "cancel")}>Ablehnen</button>
            </div>
          </div>
        );
      })}
      {message && <p role="status" aria-live="polite">{message}</p>}
    </section>
  );
}
