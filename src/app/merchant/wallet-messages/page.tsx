"use client";

import { Check, ChevronLeft, Megaphone } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { postJson } from "@/components/client-api";
import { BackToActions, reopenDay, sendNote } from "@/components/owner/actions-list";
import { useOwner } from "@/components/owner/owner-context";
import { ErrorNotice, LoadingBlock, Notice } from "@/components/owner/owner-ui";
import { FieldError, useReview } from "@/components/owner/question-form";
import { useLoad } from "@/components/owner/use-load";
import { SentMessages, type SentRow } from "@/components/owner/sent-messages";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ACTION_HINT, checkMessageText, germanWhen, MESSAGE_MAX, needsActionHint, OWNER_CONFIRM_TEXT, OWNER_GUIDANCE, QUIET_HOURS_REFUSAL, shopCapText } from "@/lib/wallet-message-rules";

type Overview = { shopName: string; reach: number; remaining: number; nextAllowedAt: string | null; quietNow: boolean; timezone: string; guidanceConfirmed: boolean; history: SentRow[] };

const DRAFT = "loynara-wallet-message-draft";
const arrow = <ChevronLeft size={20} aria-hidden="true" />;

/** The question pages' frame (Wegweiser): back link, the question as the heading; the heading takes the focus on each new step. */
function Frame({ back, title, lead, children }: { back: ReactNode; title: string; lead?: string; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null), shown = useRef(title);
  // A new step starts at the top, also after Back, whose restored scroll lands after this effect (so the next frame).
  useEffect(() => {
    if (shown.current === title) return;
    shown.current = title;
    const frame = requestAnimationFrame(() => { window.scrollTo({ top: 0 }); heading.current?.focus({ preventScroll: true }); });
    return () => cancelAnimationFrame(frame);
  }, [title]);
  return (
    <div className="ow-page ow-qpage">
      <header className="ow-pagehead"><div className="ow-qhead">{back}<h1 ref={heading} tabIndex={-1}>{title}</h1>{lead && <p>{lead}</p>}</div></header>
      {children}
    </div>
  );
}

/** The message as it lands on a locked iPhone; the clock is decoration. */
function LockScreen({ shop, text }: { shop: string; text: string }) {
  const label = useId();
  return (
    <div className="ow-qpanel ow-cardline" role="group" aria-labelledby={label}>
      <p id={label} className="ow-cardline-label">So sieht es auf dem Sperrbildschirm aus</p>
      <div className="ow-lock">
        <span className="ow-lock-time" aria-hidden="true">9:41</span>
        <div className="ow-lock-note"><b><span>{shop}</span><span>jetzt</span></b><p>{text || "Deine Nachricht"}</p></div>
      </div>
    </div>
  );
}

/** Nachricht senden (ENG-122d, Design 6 Nov): the composer with the lock-screen preview and the sent messages, then the send
 *  confirmation as a screen. Erinnerung vor der Prämie and Geburtstags-Bonus moved to Programm. */
export default function WalletMessagesPage() {
  const { me } = useOwner();
  const slug = me?.programSlug ?? "";
  const [data, reload] = useLoad<Overview>(me?.role === "owner" && slug ? `/api/merchant/wallet-messages?programSlug=${encodeURIComponent(slug)}` : null);
  const [text, setText] = useState(() => { try { return localStorage.getItem(DRAFT) ?? ""; } catch { return ""; } });
  const review = useReview<"confirm">();
  const [agreed, setAgreed] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{ audience: number } | null>(null);
  // The receipt is a short confirmation, so a toast (Design decision 4).
  useEffect(() => { if (!receipt) return; const timer = window.setTimeout(() => setReceipt(null), 4000); return () => window.clearTimeout(timer); }, [receipt]);

  const edit = (value: string) => { setText(value); setReceipt(null); try { localStorage.setItem(DRAFT, value); } catch { /* optional */ } };
  const toActions = <BackToActions />;
  const question = "Nachricht senden";

  if (!me) return null;
  if (me.role !== "owner") return <Frame back={toActions} title={question}><Notice>Nur die Inhaberin oder der Inhaber kann Nachrichten senden.</Notice></Frame>;
  if (data.state === "error") return <Frame back={toActions} title={question}><ErrorNotice message={data.message} onRetry={reload} /></Frame>;
  if (data.state !== "ok") return <Frame back={toActions} title={question}><LoadingBlock /></Frame>;
  const d = data.data;

  async function acknowledge() {
    setBusy(true); setError("");
    try { await postJson("/api/merchant/wallet-messages", { programSlug: slug, acknowledgeGuidance: true }); setAcknowledged(true); reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Das hat nicht geklappt. Versuche es noch einmal."); }
    finally { setBusy(false); }
  }
  // Legal's guidance once, before the first message: its own screen, as before.
  if (!d.guidanceConfirmed && !acknowledged) return (
    <Frame back={toActions} title="Bevor du die erste Nachricht schickst">
      <div className="ow-q">
        <div className="ow-qpanel ow-stack">
          <p>{OWNER_GUIDANCE}</p>
          <Checkbox checked={agreed} onChange={event => setAgreed(event.target.checked)}>{OWNER_CONFIRM_TEXT}</Checkbox>
        </div>
        {error && <Notice tone="danger" role="alert">{error}</Notice>}
        <div className="ow-qactions"><Button loading={busy} disabled={!agreed} onClick={() => void acknowledge()}>Verstanden</Button></div>
      </div>
    </Frame>
  );

  const checked = checkMessageText(text);
  // Finding 17 (Design, 22 Nov): „Weiter“ stays pressable for a text that is not ready; the press shows why.
  const inlineError = (text.trim() || pressed) && !checked.ok ? checked.error : "";
  const capped = d.remaining === 0, empty = d.reach === 0;
  const canContinue = checked.ok && !capped && !empty && !d.quietNow;
  // Capped, quiet hours and no reach are states their notice explains: those keep the button disabled.
  const blocked = capped || empty || d.quietNow;

  async function send() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await postJson<{ id: string; audience: number }>("/api/merchant/wallet-messages", { programSlug: slug, text });
      setReceipt({ audience: result.audience });
      setText(""); try { localStorage.removeItem(DRAFT); } catch { /* optional */ }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Die Nachricht konnte nicht gesendet werden."); }
    finally { setBusy(false); review.back(); reload(); }
  }
  async function stop(id: string) {
    try { await postJson("/api/merchant/wallet-messages/stop", { programSlug: slug, messageId: id }); } catch (cause) { setError(cause instanceof Error ? cause.message : "Das Stoppen hat nicht geklappt."); }
    reload();
  }

  // The confirmation is a screen of its own (Programm 28/30), only for a text that may still be sent.
  // One status region for the page, mounted before the receipt fills it, so the confirmation is announced (Design, 8 Nov).
  const toast = <div className="ow-toast-region" role="status">{receipt && <span className="ow-toast"><Check size={20} aria-hidden="true" />Geht raus an {receipt.audience}{"\u00a0"}Kunden</span>}</div>;
  if (review.step === "confirm" && canContinue) return (<>
    <Frame back={<button type="button" className="ow-back" onClick={review.back}>{arrow}Nachricht</button>} title={`An ${d.reach} Kunden senden?`}>
      <div className="ow-q">
        <div className="ow-qpanel ow-qnote"><Megaphone size={24} aria-hidden="true" /><div><strong>Gesendet ist gesendet.</strong><p>{sendNote(d.reach, d.remaining, reopenDay(d.history, d.timezone))}</p></div></div>
        <div className="ow-qpanel ow-cardline">
          <p className="ow-cardline-label">Deine Nachricht</p>
          <div className="ow-cardline-ground"><div className="ow-cardline-card"><p className="ow-cardline-text">{checked.ok ? checked.text : text}</p></div></div>
        </div>
        <div className="ow-qactions">
          <button type="button" className="ow-btn ow-btn--primary" aria-busy={busy} onClick={() => void send()}>Jetzt senden</button>
          <button type="button" className="ow-btn ow-btn--secondary" disabled={busy} onClick={review.back}>Abbrechen</button>
        </div>
      </div>
    </Frame>
    {toast}
  </>);

  const free = d.remaining > 0 ? `Noch ${d.remaining}\u00a0frei` : undefined;
  // Happy Hour books only purchase-amount points (loyalty.ts): other shops get the first sentence alone.
  const happyHour = me.programType === "points" && me.earningMode === "purchase";
  return (<>
    <Frame back={toActions} title={question} lead={free}>
      <div className="ow-q">
        {error && <Notice tone="danger" role="alert">{error} Dein Text ist noch da.</Notice>}
        {d.history.some(row => row.warn) && <Notice tone="warn" role="status">Nach einer deiner letzten Nachrichten haben ungewöhnlich viele Kundinnen und Kunden ihre Karte aus der Wallet entfernt. Schreibe seltener.</Notice>}
        {capped && <Notice tone="warn">{shopCapText(d.nextAllowedAt ? germanWhen(new Date(d.nextAllowedAt), d.timezone) : undefined)}</Notice>}
        {d.quietNow && <Notice tone="info">{QUIET_HOURS_REFUSAL}</Notice>}
        {empty && <Notice tone="info">Noch kann niemand deine Nachrichten bekommen. Deine Kundinnen und Kunden stimmen auf ihrer Karte zu, wenn sie sie in Apple Wallet haben. Tipp für die Kasse: „Leg dir die Karte in die Wallet und schalte Nachrichten ein, dann sagen wir dir Bescheid, wenn&apos;s was gibt.“</Notice>}
        <div className="ow-qpanel ow-field">
          <label htmlFor="wm-text">Deine Nachricht</label>
          <textarea id="wm-text" className="ow-textarea" rows={3} maxLength={MESSAGE_MAX} value={text} disabled={capped} aria-invalid={inlineError ? true : undefined} aria-describedby="wm-hint wm-error" onChange={event => edit(event.target.value)} />
          <p id="wm-hint" className="ow-qcount"><span>Konkret, für heute, mit deinem eigenen Angebot.</span><span className="ow-num">{Array.from(text).length}/{MESSAGE_MAX}</span></p>
          <FieldError id="wm-error">{inlineError}</FieldError>
        </div>
        {needsActionHint(text) && <Notice tone="warn">{ACTION_HINT}{happyHour && <> <Link className="ow-link" href="/merchant/program/happy-hour?von=aktionen">Happy Hour einstellen</Link></>}</Notice>}
        <LockScreen shop={d.shopName} text={text} />
        <p className="ow-hint">Nachrichten gehen vorerst nur an Karten in Apple Wallet. Du siehst nur Zahlen, nie Namen.</p>
        <SentMessages rows={d.history} timeZone={d.timezone} onStop={id => void stop(id)} />
        <div className="ow-qsave"><button type="button" className="ow-btn ow-btn--primary" disabled={blocked} onClick={() => { if (canContinue) review.open("confirm"); else { setPressed(true); document.getElementById("wm-text")?.focus(); } }}>Weiter</button></div>
      </div>
    </Frame>
    {toast}
  </>);
}
