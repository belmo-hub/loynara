"use client";

import Link from "next/link";
import { useState } from "react";
import { postJson } from "@/components/client-api";
import { useOwner } from "@/components/owner/owner-context";
import { ErrorNotice, LoadingBlock, Notice, PageHead } from "@/components/owner/owner-ui";
import { useLoad } from "@/components/owner/use-load";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet } from "@/components/ui/sheet";
import { AlmostCard, BirthdayCard, type Birthday, type Winback } from "@/components/owner/winback-card";
import { ACTION_HINT, checkMessageText, germanWhen, MESSAGE_MAX, needsActionHint, OWNER_CONFIRM_TEXT, OWNER_GUIDANCE, QUIET_HOURS_REFUSAL, SHOP_WEEKLY_CAP } from "@/lib/wallet-message-rules";

type Row = { id: string; text: string; status: "queued" | "sending" | "complete" | "stopped"; createdAt: string; audience: number; sent: number; failed: number; skipped: number; removed: number; warn: boolean };
type Overview = { shopName: string; reach: number; remaining: number; nextAllowedAt: string | null; quietNow: boolean; timezone: string; guidanceConfirmed: boolean; history: Row[]; winback: Winback; birthday: Birthday };

const DRAFT = "loynara-wallet-message-draft";
const stamp = (iso: string, timeZone: string) => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));
const STATUS = { queued: "Wartet", sending: "Läuft", complete: "Gesendet", stopped: "Gestoppt" } as const;
const people = (n: number) => `${n} Kundinnen und Kunden`;

function Preview({ shop, text }: { shop: string; text: string }) {
  return <div className="ow-card" role="group" aria-label="So sieht es auf dem Sperrbildschirm aus"><p className="ow-muted" style={{ fontSize: "var(--text-14)" }}>So sieht es auf dem Sperrbildschirm aus</p><p><strong>{shop}</strong> · jetzt</p><p>{text || "Deine Nachricht"}</p></div>;
}

export default function WalletMessagesPage() {
  const { me } = useOwner();
  const slug = me?.programSlug ?? "";
  const [data, reload] = useLoad<Overview>(me?.role === "owner" && slug ? `/api/merchant/wallet-messages?programSlug=${encodeURIComponent(slug)}` : null);
  const [text, setText] = useState(() => { try { return localStorage.getItem(DRAFT) ?? ""; } catch { return ""; } });
  const [open, setOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{ audience: number; at: string; text: string } | null>(null);

  const edit = (value: string) => { setText(value); setReceipt(null); try { localStorage.setItem(DRAFT, value); } catch { /* optional */ } };

  const head = <PageHead eyebrow="Aktionen" title="Nachricht an deine Stammkunden" lead="Eine kurze Nachricht auf den Sperrbildschirm von Kundinnen und Kunden mit Apple-Wallet-Karte, die zugestimmt haben." />;
  if (!me) return null;
  if (me.role !== "owner") return <div className="ow-page">{head}<Notice tone="warn" role="alert">Nur Inhaber:innen können Nachrichten senden.</Notice></div>;
  if (data.state === "error") return <div className="ow-page">{head}<ErrorNotice message={data.message} onRetry={reload} /></div>;
  if (data.state !== "ok") return <div className="ow-page">{head}<LoadingBlock /></div>;
  const d = data.data;
  if (!d.guidanceConfirmed && !acknowledged) return <div className="ow-page">{head}
    <section className="ow-card ow-stack" aria-labelledby="wm-guidance">
      <h2 id="wm-guidance">Bevor du die erste Nachricht schickst</h2>
      <p>{OWNER_GUIDANCE}</p>
      <Checkbox checked={agreed} onChange={event => setAgreed(event.target.checked)}>{OWNER_CONFIRM_TEXT}</Checkbox>
      {error && <p role="alert" style={{ color: "var(--color-danger)" }}>{error}</p>}
      <Button loading={busy} disabled={!agreed} onClick={() => void acknowledge()}>Verstanden</Button>
    </section></div>;
  const checked = checkMessageText(text);
  const inlineError = text.trim() && !checked.ok ? checked.error : "";
  const capped = d.remaining === 0, empty = d.reach === 0;
  const canContinue = checked.ok && !capped && !empty && !d.quietNow;

  async function acknowledge() {
    setBusy(true); setError("");
    try { await postJson("/api/merchant/wallet-messages", { programSlug: slug, acknowledgeGuidance: true }); setAcknowledged(true); reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Das hat nicht geklappt. Versuche es noch einmal."); }
    finally { setBusy(false); }
  }
  async function send() {
    setBusy(true); setError("");
    try {
      const result = await postJson<{ id: string; audience: number }>("/api/merchant/wallet-messages", { programSlug: slug, text });
      setReceipt({ audience: result.audience, at: new Date().toISOString(), text });
      setOpen(false); setText(""); try { localStorage.removeItem(DRAFT); } catch { /* optional */ }
      reload();
    } catch (cause) { setOpen(false); setError(cause instanceof Error ? cause.message : "Die Nachricht konnte nicht gesendet werden."); reload(); }
    finally { setBusy(false); }
  }
  async function stop(id: string) {
    try { await postJson("/api/merchant/wallet-messages/stop", { programSlug: slug, messageId: id }); } catch (cause) { setError(cause instanceof Error ? cause.message : "Das Stoppen hat nicht geklappt."); }
    reload();
  }

  return (
    <div className="ow-page">
      {head}
      {receipt && <Notice tone="ok" role="status"><strong>Gesendet.</strong> An {people(receipt.audience)} um {stamp(receipt.at, d.timezone)} Uhr. Diese Woche kannst du noch {d.remaining} {d.remaining === 1 ? "Nachricht" : "Nachrichten"} senden.</Notice>}
      {error && <Notice tone="danger" role="alert">{error} Dein Text ist noch da.</Notice>}
      {d.history.some(row => row.warn) && <Notice tone="warn" role="status">Nach einer deiner letzten Nachrichten haben ungewöhnlich viele Kundinnen und Kunden ihre Karte aus der Wallet entfernt. Prüfe, ob du zu oft oder zu werblich geschrieben hast.</Notice>}
      {capped && <Notice tone="warn">Du hast diese Woche schon {SHOP_WEEKLY_CAP} Nachrichten gesendet.{d.nextAllowedAt ? ` Die nächste geht wieder ab ${germanWhen(new Date(d.nextAllowedAt), d.timezone)}.` : ""}</Notice>}
      {d.quietNow && <Notice tone="info">{QUIET_HOURS_REFUSAL}</Notice>}
      {empty && <Notice tone="info">Noch kann niemand deine Nachrichten bekommen. Deine Kundinnen und Kunden stimmen auf ihrer Karte zu, wenn sie sie in Apple Wallet haben. Tipp für die Kasse: „Leg dir die Karte in die Wallet und schalte Nachrichten ein, dann sagen wir dir Bescheid, wenn&apos;s was gibt.“</Notice>}
      <section className="ow-card ow-stack" aria-labelledby="wm-write">
        <h2 id="wm-write">Deine Nachricht</h2>
        <p className="ow-muted" style={{ fontSize: "var(--text-14)" }}>Am besten wirkt: konkret, für heute, mit deinem eigenen Angebot. Zum Beispiel: „Heute ruhig: doppelte Punkte bis 17 Uhr.“</p>
        <div className="ow-field">
          <label htmlFor="wm-text">Deine Nachricht</label>
          <textarea id="wm-text" className="ow-textarea" rows={3} maxLength={MESSAGE_MAX} value={text} disabled={capped} aria-invalid={inlineError ? true : undefined} aria-describedby="wm-rules" onChange={event => edit(event.target.value)} />
          <p id="wm-rules" className="ow-muted" style={{ fontSize: "var(--text-14)" }}>{Array.from(text).length} / {MESSAGE_MAX} · Ohne Link. Höchstens {SHOP_WEEKLY_CAP} Nachrichten pro Woche.</p>
        </div>
        {inlineError && <p role="alert" style={{ color: "var(--color-danger)" }}>{inlineError}</p>}
        {needsActionHint(text) && <Notice tone="warn">{ACTION_HINT}. <Link href="/merchant/program">Zur Aktion (Happy Hour)</Link></Notice>}
        <Preview shop={d.shopName} text={text} />
        <p>Erreicht {people(d.reach)}, die zugestimmt haben. <span className="ow-muted">Diese Woche noch {d.remaining} {d.remaining === 1 ? "Nachricht" : "Nachrichten"}.</span></p>
        <p className="ow-muted" style={{ fontSize: "var(--text-14)" }}>Nachrichten gehen vorerst nur an Karten in Apple Wallet. Du siehst nur Zahlen, nie Namen.</p>
        <Button disabled={!canContinue} onClick={() => setOpen(true)}>{d.quietNow ? "Ab 8 Uhr senden" : "Weiter"}</Button>
      </section>
      <AlmostCard slug={slug} initial={d.winback} />
      <BirthdayCard slug={slug} type={d.winback.type} initial={d.birthday} />
      <section className="ow-card ow-stack" aria-labelledby="wm-history">
        <h2 id="wm-history">Gesendete Nachrichten</h2>
        {d.history.length === 0 ? <p className="ow-muted">Noch keine Nachricht gesendet.</p> : (
          <table className="ow-table"><thead><tr><th>Zeit</th><th>Text</th><th>Status</th><th>Erreicht</th><th></th></tr></thead>
            <tbody>{d.history.map(row => <tr key={row.id}>
              <td data-label="Zeit">{stamp(row.createdAt, d.timezone)}</td><td data-label="Text">{row.text}</td><td data-label="Status">{STATUS[row.status]}</td>
              <td data-label="Erreicht">{row.sent} von {row.audience}{row.failed ? `, ${row.failed} fehlgeschlagen` : ""}{row.skipped ? `, ${row.skipped} übersprungen` : ""}{row.sent > 0 ? <><br /><span className="ow-muted">Karten entfernt (nur Apple Wallet): {row.removed} innerhalb von 48 Stunden</span></> : null}</td>
              <td>{row.status === "queued" || row.status === "sending" ? <Button size="sm" variant="secondary" onClick={() => void stop(row.id)}>Stoppen</Button> : null}</td>
            </tr>)}</tbody></table>
        )}
      </section>
      <Sheet open={open} onClose={() => setOpen(false)} title={`An ${people(d.reach)} senden?`}
        footer={<><Button loading={busy} onClick={() => void send()}>Jetzt senden</Button><Button variant="quiet" onClick={() => setOpen(false)}>Abbrechen</Button></>}>
        <Preview shop={d.shopName} text={text} />
        <p>Gesendet ist gesendet.</p>
      </Sheet>
    </div>
  );
}
