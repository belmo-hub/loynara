"use client";

import { useEffect, useState } from "react";
import { apiJson, postJson } from "./client-api";
import { Button } from "./ui/button";
import styles from "./customer/panels.module.css";

type Birthday = { available: boolean; day: number | null; month: number | null; text: string };
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/**
 * The optional birthday (ENG-049): day and month only, Legal's text, saved and deleted on the card. Renders nothing while
 * the walletMessages surface is withheld (404) or the shop has no birthday bonus and nothing is stored.
 */
export function CardBirthday({ token }: { token: string }) {
  const [state, setState] = useState<Birthday | null>(null);
  const [day, setDay] = useState(""); const [month, setMonth] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(""); const [error, setError] = useState("");
  const url = `/api/card/${encodeURIComponent(token)}/birthday`;

  useEffect(() => {
    let active = true;
    void apiJson<Birthday>(url).then(result => { if (active) { setState(result); setDay(result.day ? String(result.day) : ""); setMonth(result.month ? String(result.month) : ""); } }).catch(() => { /* the card works without this panel */ });
    return () => { active = false; };
  }, [url]);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); setState(await apiJson<Birthday>(url)); setNotice(done); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Das hat nicht geklappt. Versuche es noch einmal."); }
    finally { setBusy(false); }
  }
  const save = () => run(() => postJson(url, { day: Number(day), month: Number(month) }), "Gespeichert. In deiner Geburtstagswoche gibt es deinen Bonus.");
  const remove = () => run(async () => { await apiJson(url, { method: "DELETE" }); setDay(""); setMonth(""); }, "Gelöscht.");

  if (!state?.available) return null;
  return <section className={styles.panel} aria-labelledby="birthday-title">
    <h2 id="birthday-title">Geburtstag (freiwillig)</h2>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <label>Tag <select value={day} disabled={busy} onChange={event => setDay(event.target.value)}><option value="">–</option>{Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></label>
      <label>Monat <select value={month} disabled={busy} onChange={event => setMonth(event.target.value)}><option value="">–</option>{MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}</select></label>
    </div>
    <p className={styles.muted}>{state.text}</p>
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <Button size="sm" loading={busy} disabled={!day || !month} onClick={() => void save()}>Speichern</Button>
      {state.day !== null && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void remove()}>Löschen</Button>}
    </div>
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
