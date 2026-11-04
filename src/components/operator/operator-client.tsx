"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { AlertCircle, ScanLine } from "lucide-react";
import { QrScanner } from "@/components/qr-scanner";
import { ClientApiError, postJson } from "@/components/client-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useFormCheck } from "@/components/ui/form-check";
import { TextField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { earliestEndDate, END_DATE_TOO_EARLY } from "@/lib/operator-date";
import { germanDate } from "@/lib/programme-end-date";
import { plateLabelFromScan } from "./plate-scan";
import { copyText } from "@/components/copy-text";

type Row = { walletTemplate: { templateId: string; source: "table" | "env" } | null; walletMessages: { messages: number; sent: number; removed: number; warn: boolean } | null; tenantId: string; tenant: string; weeklyReport: boolean; locationId: string; location: string; city: string; programId: string; programme: string; status: string; tapMode: string; cards: number; lastAward: Date | string | null; endDate: string | null; nextEnd: string | null; confirmed: boolean; requestedDays: number | null; cancellationHistory: { action: string; by: string; at: Date | string; oldEndDate: string | null; newEndDate: string | null }[] };
type Plate = { plateLabel: string | null; status: string; everTapped: boolean; code: "none" | "open" | "locked" | "used"; alertedAt: Date | string | null; programId: string | null; merchant: string | null; location: string | null; programme: string | null };
type Shop = { merchant: string; location: string; programme: string } | null;
type EntryPreview = { endDate: string; past: boolean; facts: { lastDay: Fact; lastInvoice: Fact; exportUntil: Fact } | null };
type EndPreview = { result: string; end: string | null; endDate?: string };
type Fact = { label: string; value: string; sub: string };
type Choice = { endDate: string; label: string; consent: boolean; facts: { lastDay: Fact; lastInvoice: Fact; exportUntil: Fact } };
/** ENG-167 (b): one business's cancellation, from lib/contract-end-view (operatorCancellations). */
type Cancellation = { tenantId: string; tenant: string; locations: string[]; programId: string; endDate: string; endText: string; acknowledged: boolean; origin: string; stripeNotEnded: boolean; freeMonth: boolean; factsLine: string; badge: string; deadline: string | null; requestedOn: string | null; anchorDay: number; choices: Choice[]; withdrawal: string };
// #207's guard names days as 2026-12-01; the console shows 01.12.2026.
const readable = (message: string) => message.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$3.$2.$1");
// Draft (Design, to Marketing): a receipt time after now.
const FUTURE_RECEIPT = "Der Eingang liegt in der Zukunft. Prüfe Datum und Uhrzeit.";
/** Now in Berlin as a datetime-local value, the latest receipt time the field accepts. */
const berlinNow = () => new Date().toLocaleString("sv-SE", { timeZone: "Europe/Berlin" }).replace(" ", "T").slice(0, 16);
/** A datetime-local value read as Berlin time (Legal: an e-mailed cancellation counts from the moment it arrived). */
function berlinIso(local: string) {
  const guess = new Date(`${local}:00Z`);
  const shown = Date.parse(`${guess.toLocaleString("sv-SE", { timeZone: "Europe/Berlin" }).replace(" ", "T")}Z`);
  return new Date(guess.getTime() - (shown - guess.getTime())).toISOString();
}
type Preview = { result: string; plateLabel: string; from: Shop; to: Shop };
type TemplatePreview = { result: string; from: string | null; to: string; ready: boolean };
type Awaiting = { tenantId: string; tenant: string; location: string; city: string; inviteId: string; email: string; expiresAt: Date | string; status: "pending" | "accepted" | "revoked" | "expired" };
type Invitation = { tenant: string; email: string; link: string; qr: string; expiresAt: string };
const INVITE_STATUS = { pending: "Einladung offen", accepted: "Konto angelegt, Einrichtung offen", revoked: "Einladung widerrufen", expired: "Einladung abgelaufen" } as const;
type Billing = { tenantId: string; tenant: string; status: string; planCode: string | null; currency: string; started: boolean; cancelling: boolean; lastFreeDay: string | null; ownerName: string | null; ownerEmail: string | null; city: string | null };
type FreeMonth = { tenantId: string; shop: string; locations: string[]; lastFreeDay: string; sent: boolean };
type Guarantee = { locationId: string; tenant: string; location: string; customers: number | null; outcome: string | null; credited: boolean; decidedAt: Date | string | null };

const shopText = (shop: Shop) => shop ? `${shop.merchant} · ${shop.location} · ${shop.programme}` : "frei";
const date = (value: Date | string | null) => value ? new Date(value).toLocaleDateString("de-DE") : "noch keine";
const STEP: Record<string, string> = { request: "Kündigung angefragt", withdraw: "zurückgezogen", schedule: "Datum gesetzt", confirm: "bestätigt", end: "beendet" };
const when = (value: Date | string) => new Date(value).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });
const templateText = (t: Row["walletTemplate"]) => t ? `${t.templateId} (${t.source === "table" ? "Datenbank" : "Umgebungsvariable"})` : "keine";
const STATUS: Record<string, string> = { unlinked: "frei", active: "verknüpft", revoked: "gesperrt", replaced: "ersetzt" };
const CODE = { none: "kein Code", open: "Code offen", locked: "Code offen, ein Konto gesperrt", used: "Code benutzt" } as const;

// „erreicht“: the location reached the start target, no credit. „nicht erreicht“: the month-2 credit is owed or issued.
const GUARANTEE_TEXT = (g: Guarantee) => g.outcome === "credit" ? (g.credited ? "Startgarantie nicht erreicht: Monat 2 kostenlos, Gutschrift erteilt" : "Startgarantie nicht erreicht: Gutschrift noch offen")
  : g.outcome === "reached" ? "Startgarantie erreicht" : g.outcome === "late" ? "Startgarantie zu spät entschieden, keine Gutschrift" : "Startgarantie entfällt (gekündigt, nicht bezahlt oder Vertrag nach Stichtag)";
const PLAN_TEXT: Record<string, string> = { founding: "Gründungspreis 39 €", list: "Listenpreis 49 €" };
const BILLING_STATUS: Record<string, string> = { manual_pending: "kein Abo", pending_checkout: "Checkout offen", active: "Abo aktiv", past_due: "Zahlung offen", suspended: "Abo ausgesetzt", cancelled: "Abo beendet" };

export function OperatorClient({ rows, plates, awaiting, billing, guarantees, freeMonths, cancellations }: { rows: Row[]; plates: Plate[]; awaiting: Awaiting[]; billing: Billing[]; guarantees: Guarantee[]; freeMonths: FreeMonth[]; cancellations: Cancellation[] }) {
  const router = useRouter();
  const [label, setLabel] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [scanning, setScanning] = useState(false);
  const [programId, setProgramId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<Row | null>(null);
  const [endDate, setEndDate] = useState("");
  const [endPreview, setEndPreview] = useState<EndPreview | null>(null);
  const [tplRow, setTplRow] = useState<Row | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [tplPreview, setTplPreview] = useState<TemplatePreview | null>(null);
  const [shopError, setShopError] = useState("");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [copied, setCopied] = useState("");
  const [revoking, setRevoking] = useState<Awaiting | null>(null);
  const [codes, setCodes] = useState<Array<{ plateLabel: string; code: string }> | null>(null);
  const plate = plates.find(p => p.plateLabel === label);
  const withoutCode = plates.filter(p => p.status === "unlinked" && p.code === "none").map(p => p.plateLabel!);
  // Only programmes a plate may be linked to (the server enforces the same rule).
  const linkable = rows.filter(r => r.status === "active" && r.tapMode === "staff_confirmed");

  function open(raw: string) {
    const found = plateLabelFromScan(raw);
    setScanning(false); setPreview(null); setProgramId(""); setTyped("");
    if (!found || !plates.some(p => p.plateLabel === found)) { setLabel(null); setError(found ? `Platte ${found} gibt es nicht.` : "Das ist kein Plattencode."); return; }
    setError(""); setLabel(found);
  }
  async function send(target: string | null, execute: boolean) {
    setBusy(true); setError("");
    try {
      const result = await postJson<Preview>("/api/operator/plate", { plateLabel: label, programId: target, execute });
      if (execute) { setLabel(null); setPreview(null); router.refresh(); } else setPreview(result);
    } catch (cause) { setError(cause instanceof ClientApiError ? cause.message : "Das hat nicht geklappt."); }
    finally { setBusy(false); }
  }
  async function sendEnd(execute: boolean) {
    if (endDate < earliestEndDate(new Date())) { setSheetError(END_DATE_TOO_EARLY); return; }
    setBusy(true); setSheetError("");
    try {
      const result = await postJson<EndPreview>("/api/operator/programme", { programId: prog!.programId, endDate, execute });
      if (execute) { setProg(null); setEndPreview(null); router.refresh(); } else setEndPreview(result);
    } catch (cause) { setSheetError(readable(cause instanceof ClientApiError ? cause.message : "Das hat nicht geklappt.")); }
    finally { setBusy(false); }
  }
  async function sendTemplate(execute: boolean) {
    setBusy(true); setError("");
    try {
      const result = await postJson<TemplatePreview>("/api/operator/wallet-template", { tenantId: tplRow!.tenantId, locationId: tplRow!.locationId, templateId, execute });
      if (execute) { setTplRow(null); setTplPreview(null); router.refresh(); } else setTplPreview(result);
    } catch (cause) { setError(cause instanceof ClientApiError ? cause.message : "Das hat nicht geklappt."); }
    finally { setBusy(false); }
  }
  const openTemplate = (row: Row) => { setTplRow(row); setTemplateId(""); setTplPreview(null); setError(""); };
  const closeTemplate = () => { setTplRow(null); setTplPreview(null); setError(""); };
  const openEnd = (row: Row) => { setProg(row); setEndDate(row.endDate ?? ""); setEndPreview(null); setSheetError(""); };
  const closeEnd = () => { setProg(null); setEndPreview(null); setSheetError(""); };
  // ENG-167 (b): the end-date sheet (keep, or later with consent; never earlier), the withdrawal on the shop's wish, and the
  // entry of a cancellation that came by e-mail. These sheets keep their own error, so it never shows twice on the page.
  const [ending, setEnding] = useState<Cancellation | null>(null);
  const [choice, setChoice] = useState("");
  const [consent, setConsent] = useState(false);
  const [checked, setChecked] = useState<Choice | null>(null);
  const [withdrawing, setWithdrawing] = useState<Cancellation | null>(null);
  const [entry, setEntry] = useState<Row | null>(null);
  const [receivedAt, setReceivedAt] = useState("");
  const [entryEnd, setEntryEnd] = useState<EntryPreview | null>(null);
  // Legal (§ 130 BGB): an e-mail older than 14 days still counts from its arrival; the tick confirms it was checked, not taken back.
  const [pastEnd, setPastEnd] = useState(false);
  const [acceptPast, setAcceptPast] = useState(false);
  const [sheetError, setSheetError] = useState("");
  const picked = ending?.choices.find(c => c.endDate === choice) ?? null;
  const openEnding = (c: Cancellation) => { setEnding(c); setChoice(c.endDate); setConsent(false); setChecked(null); setSheetError(""); };
  const closeSheets = () => { setEnding(null); setChecked(null); setWithdrawing(null); setEntry(null); setEntryEnd(null); setPastEnd(false); setAcceptPast(false); setSheetError(""); };
  async function operate(body: Record<string, unknown>, after: () => void) {
    setBusy(true); setSheetError("");
    try { await postJson("/api/operator/programme", body); after(); }
    catch (cause) { setSheetError(readable(cause instanceof ClientApiError ? cause.message : "Das hat nicht geklappt.")); }
    finally { setBusy(false); }
  }
  const checkEnd = () => operate({ programId: ending!.programId, endDate: choice, consent: picked?.consent === true, execute: false }, () => setChecked(picked));
  const confirmEnd = () => operate({ programId: ending!.programId, endDate: choice, consent: picked?.consent === true, execute: true }, () => { closeSheets(); router.refresh(); });
  const withdraw = () => operate({ programId: withdrawing!.programId, command: "withdraw", execute: true }, () => { closeSheets(); router.refresh(); });
  async function checkEntry(execute: boolean) {
    setBusy(true); setSheetError("");
    try {
      const result = await postJson<{ endDate?: string | null; past?: boolean; facts?: EntryPreview["facts"] }>("/api/operator/programme", { programId: entry!.programId, command: "request", receivedAt: berlinIso(receivedAt), acceptLateEntry: acceptPast, execute });
      if (execute) { closeSheets(); router.refresh(); } else setEntryEnd(result.endDate ? { endDate: result.endDate, past: result.past === true, facts: result.facts ?? null } : null);
    } catch (cause) {
      if (cause instanceof ClientApiError && cause.code === "LATE_ENTRY") { setPastEnd(true); return; }
      if (cause instanceof ClientApiError && cause.code === "INVALID_RECEIVED_AT") { setSheetError(FUTURE_RECEIPT); return; }
      setSheetError(readable(cause instanceof ClientApiError ? cause.message : "Das hat nicht geklappt.")); }
    finally { setBusy(false); }
  }
  // The list says what the Kündigungen card says (C40, C25), so one shop never shows two states.
  const endText = (r: Row) => cancellations.find(c => c.tenantId === r.tenantId)?.badge ?? (r.endDate ? `gekündigt zum ${germanDate(r.endDate)}` : "keine Kündigung");
  // One age per request: the Kündigungen entry's own (C25), so the two cards never disagree.
  const origin = (r: Row) => cancellations.find(c => c.tenantId === r.tenantId)?.origin ?? (r.requestedDays === null ? "vom Operator geplant" : r.requestedDays === 0 ? "heute angefragt" : r.requestedDays === 1 ? "gestern angefragt" : `vor ${r.requestedDays} Tagen angefragt`);
  const firstOpen = cancellations.findIndex(c => !c.acknowledged);
  const close = () => { setLabel(null); setPreview(null); setError(""); };
  // Go-live starts the paid contract's free first month (ENG-123): a second click confirms it.
  const [startFor, setStartFor] = useState<string | null>(null);
  // § 14 UStG: the invoice recipient's full name and address, recorded at go-live and sent to Stripe.
  const fields = useFormCheck();
  const [recipient, setRecipient] = useState({ name: "", line1: "", postalCode: "", city: "", email: "" });
  const openStart = (b: Billing) => { setStartFor(b.tenantId); setRecipient({ name: b.ownerName ?? "", line1: "", postalCode: "", city: b.city ?? "", email: b.ownerEmail ?? "" }); setError(""); };
  async function startBilling(tenantId: string) {
    setBusy(true); setError("");
    try { await postJson("/api/operator/billing-start", { tenantId, billing: recipient }); setStartFor(null); router.refresh(); }
    catch (cause) { setError(cause instanceof ClientApiError ? cause.message : "Das hat nicht geklappt."); }
    finally { setBusy(false); }
  }
  async function setPlan(tenantId: string, planCode: string) {
    setBusy(true); setError("");
    try { await postJson("/api/operator/billing-plan", { tenantId, planCode }); router.refresh(); }
    catch (cause) { setError(cause instanceof ClientApiError ? cause.message : "Das hat nicht geklappt."); }
    finally { setBusy(false); }
  }

  // Codes are shown once, for printing the box cards: the server keeps only their hashes.
  async function sendCodes(body: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      if (body.action === "issue") setCodes((await postJson<{ codes: Array<{ plateLabel: string; code: string }> }>("/api/operator/plate-codes", body)).codes);
      else await postJson("/api/operator/plate-codes", body);
      setLabel(null); router.refresh();
    } catch (cause) { setError(cause instanceof ClientApiError ? cause.message : "Das hat nicht geklappt."); }
    finally { setBusy(false); }
  }

  // The link is shown once, here: the server keeps only its hash.
  async function shop(body: Record<string, unknown>, tenant: string) {
    setBusy(true); setShopError(""); setCopied("");
    try {
      if (body.action === "revoke") await postJson("/api/operator/shop", body);
      else {
        const result = await postJson<{ link: string; email: string; expiresAt: string }>("/api/operator/shop", body);
        setInvitation({ tenant, email: result.email, link: result.link, expiresAt: result.expiresAt, qr: await QRCode.toDataURL(result.link, { margin: 1, width: 240, errorCorrectionLevel: "M" }) });
      }
      router.refresh();
      return true;
    } catch (cause) { setShopError(cause instanceof ClientApiError ? cause.message : "Das hat nicht geklappt."); return false; }
    finally { setBusy(false); }
  }
  async function createShop(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fields.check(event.currentTarget)) return;
    const element = event.currentTarget, form = new FormData(element);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    if (await shop({ action: "create", businessName: text("businessName"), ...(text("locationName") ? { locationName: text("locationName") } : {}), city: text("city"), country: text("country"), timezone: text("timezone"), ownerEmail: text("ownerEmail") }, text("businessName"))) element.reset();
  }

  return <main className="ow-page" id="ow-main">
    <PageHeader title="Operator" description="Platten und Geschäfte. Nur für dich sichtbar." />
    {error && !label ? <p role="alert">{error}</p> : null}

    <Card as="section" aria-labelledby="op-new">
      <CardHeader id="op-new" title="Neues Geschäft" description="Legt Geschäft und Standort an und erstellt eine Einladung für die Inhaberin oder den Inhaber. Sie gilt 7 Tage und nur einmal. Das Passwort wählt die Person selbst." />
      <form onSubmit={createShop} onInput={fields.onInput} noValidate style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 8 }}>
        <TextField id="op-1" error={fields.error("op-1")} label="Geschäftsname" name="businessName" required minLength={2} maxLength={180} autoComplete="off" />
        <TextField id="op-2" error={fields.error("op-2")} label="Standort (optional)" name="locationName" minLength={2} maxLength={180} autoComplete="off" hint="Leer lassen: wie der Geschäftsname." />
        <TextField id="op-3" error={fields.error("op-3")} label="Stadt" name="city" required minLength={2} maxLength={120} autoComplete="off" />
        <Select label="Land" name="country" defaultValue="DE"><option value="DE">Deutschland</option><option value="MA">Marokko</option></Select>
        <Select label="Zeitzone" name="timezone" defaultValue="Europe/Berlin"><option value="Europe/Berlin">Europe/Berlin</option><option value="Africa/Casablanca">Africa/Casablanca</option></Select>
        <TextField id="op-4" error={fields.error("op-4")} label="E-Mail der Inhaberin oder des Inhabers" name="ownerEmail" type="email" required maxLength={320} autoComplete="off" hint="Die Einladung gilt nur für diese Adresse." />
        {shopError && !invitation ? <p role="alert">{shopError}</p> : null}
        <Button type="submit" variant="secondary" block loading={busy}>Geschäft anlegen und einladen</Button>
      </form>
      {awaiting.length ? <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }} aria-label="Geschäfte ohne Programm">
        {awaiting.map(a => <li key={a.tenantId} style={{ display: "grid", gap: 4, paddingTop: 8, borderTop: "1px solid var(--color-line, currentColor)" }}>
          <span><strong>{a.tenant}</strong> · {a.location} ({a.city})</span>
          <span className="ow-muted" style={{ overflowWrap: "anywhere" }}>{INVITE_STATUS[a.status]} · {a.email}{a.status === "pending" ? ` · gültig bis ${date(a.expiresAt)}` : ""}</span>
          {a.status === "pending" ? <div><Button variant="quiet" style={{ color: "var(--color-danger)" }} onClick={() => setRevoking(a)}>Einladung widerrufen</Button></div>
            : a.status !== "accepted" ? <Button variant="secondary" block style={{ overflowWrap: "anywhere" }} loading={busy} onClick={() => void shop({ action: "reissue", tenantId: a.tenantId, ownerEmail: a.email }, a.tenant)}>Neue Einladung an {a.email}</Button> : null}
        </li>)}
      </ul> : null}
    </Card>

    {cancellations.length ? <Card as="section" aria-labelledby="op-cancel">
      <CardHeader id="op-cancel" title="Kündigungen" description="Offene zuerst. Eine Kündigung gilt ab Eingang. Bestätigen heißt: Datum behalten oder mit Zustimmung des Geschäfts nach hinten verschieben." />
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
        {cancellations.map((c, index) => <li key={c.tenantId} style={{ display: "grid", gap: 4 }}>
          <span><strong>{c.tenant}</strong> · {c.locations.join(", ")}</span>
          <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <Badge tone={c.acknowledged ? "success" : "warning"}>{c.badge}</Badge>
            {c.deadline ? <Badge tone="danger"><AlertCircle size={14} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 4 }} />{c.deadline}</Badge> : null}
            {/* C41's opposite (draft): the free-month cancel has not reached Stripe, so someone must look. */}
            {c.stripeNotEnded ? <Badge tone="danger"><AlertCircle size={14} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 4 }} />Stripe-Abo nicht beendet</Badge> : null}
          </span>
          <span className="ow-muted" style={{ fontVariantNumeric: "tabular-nums" }}>{c.factsLine}</span>
          {/* Design: one green on the console, the most urgent open cancellation (sorted open first, then by end). */}
          <Button variant={index === firstOpen ? "primary" : "secondary"} style={{ justifySelf: "start" }} onClick={() => openEnding(c)}>{c.acknowledged ? "Datum ändern" : "Datum bestätigen"}</Button>
        </li>)}
      </ul>
    </Card> : null}

    {guarantees.length ? <Card as="section" aria-labelledby="op-guarantee">
      <CardHeader id="op-guarantee" title="Startgarantie" description="Je Standort einmal entschieden, mit der Rechnung für Monat 2. Kund:innen = mit bestätigter Gutschrift im ersten Monat." />
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {guarantees.map(g => <li key={g.locationId} role={g.outcome === "credit" && !g.credited ? "alert" : "status"}><strong>{g.tenant}</strong> · {g.location} · <Badge tone={g.outcome === "credit" ? (g.credited ? "success" : "warning") : "neutral"}>{GUARANTEE_TEXT(g)}</Badge> · {g.customers} Kund:innen · entschieden am {date(g.decidedAt)}</li>)}
      </ul>
    </Card> : null}

    <Card as="section" aria-labelledby="op-billing">
      <CardHeader id="op-billing" title="Tarife" description="Ohne Wahl gilt der Listenpreis. Am Go-live-Tag die Abrechnung starten: Der erste Monat ist kostenlos, danach bleibt der Tarif fest." />
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {billing.filter(b => b.currency === "EUR").map(b => <li key={b.tenantId} style={{ display: "grid", gap: 4 }}>
          <span><strong>{b.tenant}</strong> · <Badge tone={b.status === "active" ? "success" : "neutral"}>{BILLING_STATUS[b.status] ?? b.status}</Badge></span>
          <Select label={`Tarif für ${b.tenant}`} value={b.planCode ?? ""} disabled={busy} onChange={event => { if (event.target.value) void setPlan(b.tenantId, event.target.value); }}>
            <option value="">Noch nicht gewählt</option>
            {Object.entries(PLAN_TEXT).map(([code, text]) => <option key={code} value={code}>{text}</option>)}
          </Select>
          {/* ENG-167 (P4): a free-month cancellation is entered and confirmed in „Kündigungen“, like every other end. */}
          {b.lastFreeDay ? <span className="ow-muted">Kostenlos bis {b.lastFreeDay}{b.cancelling ? " · gekündigt, keine Rechnung" : ""}</span>
            : b.started ? null
              : startFor === b.tenantId
                ? <form style={{ display: "grid", gap: 8 }} onInput={fields.onInput} noValidate onSubmit={event => { event.preventDefault(); if (fields.check(event.currentTarget)) void startBilling(b.tenantId); }}>
                  <p className="ow-muted">Rechnungsempfänger (wie in der Pilotvereinbarung):</p>
                  <TextField id="op-5" error={fields.error("op-5")} label="Name" value={recipient.name} onChange={event => setRecipient(r => ({ ...r, name: event.target.value }))} required autoComplete="off" />
                  <TextField id="op-6" error={fields.error("op-6")} label="Straße und Hausnummer" value={recipient.line1} onChange={event => setRecipient(r => ({ ...r, line1: event.target.value }))} required autoComplete="off" />
                  <TextField id="op-7" error={fields.error("op-7")} label="Postleitzahl" value={recipient.postalCode} onChange={event => setRecipient(r => ({ ...r, postalCode: event.target.value }))} required inputMode="numeric" pattern="\d{5}" autoComplete="off" />
                  <TextField id="op-8" error={fields.error("op-8")} label="Ort" value={recipient.city} onChange={event => setRecipient(r => ({ ...r, city: event.target.value }))} required autoComplete="off" />
                  <TextField id="op-9" error={fields.error("op-9")} label="E-Mail für Rechnungen" type="email" value={recipient.email} onChange={event => setRecipient(r => ({ ...r, email: event.target.value }))} required autoComplete="off" />
                  {error ? <p role="alert">{error}</p> : null}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button type="submit" loading={busy}>Heute starten bestätigen</Button><Button type="button" variant="quiet" onClick={() => setStartFor(null)}>Zurück</Button></div>
                </form>
                : <div><Button variant="secondary" onClick={() => openStart(b)}>Abrechnung starten (Go-live)</Button></div>}
        </li>)}
      </ul>
    </Card>

    {freeMonths.length ? <Card as="section" aria-labelledby="op-free-month">
      <CardHeader id="op-free-month" title="Kostenloser Monat endet bald" description="Die Erinnerung geht 7 Tage vorher per E-Mail raus. Steht hier „nicht gesendet“, bitte selbst von support@ schicken." />
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {freeMonths.map(f => <li key={f.tenantId} role={f.sent ? "status" : "alert"}><strong>{f.shop}</strong> · {f.locations.join(", ")} · letzter freier Tag {f.lastFreeDay} · <Badge tone={f.sent ? "success" : "warning"}>{f.sent ? "Erinnerung gesendet" : "nicht gesendet"}</Badge></li>)}
      </ul>
    </Card> : null}

    <Card as="section" aria-labelledby="op-plates">
      <CardHeader id="op-plates" title="Platten" action={<Button variant="secondary" icon={<ScanLine size={18} />} onClick={() => setScanning(s => !s)}>Platte scannen</Button>} />
      {withoutCode.length ? <Button variant="secondary" block loading={busy} onClick={() => void sendCodes({ action: "issue", plateLabels: withoutCode })}>Aktivierungscodes für {withoutCode.length} freie {withoutCode.length === 1 ? "Platte" : "Platten"} erzeugen</Button> : null}
      {scanning ? <QrScanner onDetected={open} onClose={() => setScanning(false)} /> : null}
      <form noValidate onSubmit={event => { event.preventDefault(); open(typed); }} style={{ display: "flex", gap: 8, alignItems: "end" }}>
        <TextField label="Plattenname" placeholder="P-007" value={typed} onChange={event => setTyped(event.target.value)} autoCapitalize="characters" autoComplete="off" style={{ flex: 1 }} />
        <Button type="submit" variant="secondary">Öffnen</Button>
      </form>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {plates.map(p => <li key={p.plateLabel}>
          <button type="button" onClick={() => open(p.plateLabel!)} style={{ width: "100%", minHeight: 56, textAlign: "left", display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, alignItems: "center", padding: "8px 12px", background: "transparent", border: "1px solid var(--color-line, currentColor)", borderRadius: "var(--radius-md)", color: "inherit", font: "inherit" }}>
            <span style={{ minWidth: 0 }}><strong style={{ whiteSpace: "nowrap" }}>{p.plateLabel}</strong><br /><span className="ow-muted">{p.programId ? shopText({ merchant: p.merchant!, location: p.location!, programme: p.programme! }) : "frei"}</span></span>
            <span style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <Badge tone={p.status === "active" ? "success" : "neutral"}>{STATUS[p.status] ?? p.status}</Badge>
              <Badge>{p.everTapped ? "getippt" : "nie getippt"}</Badge>
              {p.status === "unlinked" || p.code !== "none" ? <Badge tone={p.code === "locked" ? "warning" : "neutral"}>{CODE[p.code]}</Badge> : null}
              {p.alertedAt ? <Badge tone="warning">viele Versuche am {date(p.alertedAt)}</Badge> : null}
            </span>
          </button>
        </li>)}
        {plates.length === 0 ? <li className="ow-muted">Noch keine Platten.</li> : null}
      </ul>
    </Card>

    <Card as="section" aria-labelledby="op-shops">
      <CardHeader id="op-shops" title="Geschäfte" description="Nur Lesen." />
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {rows.map(r => <li key={r.programId} style={{ padding: "8px 0", borderTop: "1px solid var(--color-line, currentColor)" }}>
          <strong>{r.tenant}</strong> · {r.location} ({r.city})<br />
          <span className="ow-muted">{r.programme} · {r.status === "active" ? "aktiv" : "archiviert"} · {r.cards} Karten · letzte Gutschrift: {date(r.lastAward)} · Wochenbericht {r.weeklyReport ? "an" : "aus"}{r.endDate ? ` · ${endText(r)} · ${origin(r)}` : ""}</span>
          {r.walletMessages ? <><br /><span className={r.walletMessages.warn ? undefined : "ow-muted"} role={r.walletMessages.warn ? "alert" : undefined}>Wallet-Nachrichten (30 Tage): {r.walletMessages.messages} gesendet an {r.walletMessages.sent} Karten · Karten entfernt innerhalb von 48 Stunden (nur Apple Wallet): {r.walletMessages.removed}{r.walletMessages.warn ? " · Warnung: mehr Karten entfernt als erwartet" : ""}</span></> : null}
          {r.cancellationHistory.length ? <details><summary className="ow-muted">Kündigungsverlauf ({r.cancellationHistory.length})</summary>
            <ol className="ow-muted">{r.cancellationHistory.map((e, i) => <li key={i}>{when(e.at)} · {e.by}: {STEP[e.action] ?? e.action} · {e.oldEndDate ? germanDate(e.oldEndDate) : "kein Datum"} → {e.newEndDate ? germanDate(e.newEndDate) : "kein Datum"}</li>)}</ol>
          </details> : null}
          {r.status === "active" && !r.endDate ? <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Button variant="quiet" onClick={() => { setEntry(r); setReceivedAt(""); setEntryEnd(null); setSheetError(""); }}>Kündigung per E-Mail eintragen</Button>
            <Button variant="quiet" onClick={() => openEnd(r)}>Enddatum setzen</Button>
          </div> : null}
        </li>)}
      </ul>
    </Card>

    <Sheet open={!!revoking} onClose={() => setRevoking(null)} title="Einladung widerrufen?"
      footer={revoking ? <><Button variant="quiet" onClick={() => setRevoking(null)}>Abbrechen</Button><Button variant="danger" loading={busy} onClick={() => void shop({ action: "revoke", inviteId: revoking.inviteId }, revoking.tenant).then(() => setRevoking(null))}>Widerrufen</Button></> : null}>
      {revoking ? <p>Der Link für <strong>{revoking.email}</strong> ({revoking.tenant}) funktioniert danach nicht mehr. Du kannst eine neue Einladung schicken.</p> : null}
    </Sheet>

    <Sheet open={!!invitation} onClose={() => setInvitation(null)} title="Einladung">
      {invitation ? <div style={{ display: "grid", gap: 12 }}>
        <p><strong>{invitation.tenant}</strong> · für {invitation.email} · gültig bis {date(invitation.expiresAt)}</p>
        <Image unoptimized src={invitation.qr} alt={`QR-Code der Einladung für ${invitation.tenant}`} width={240} height={240} style={{ justifySelf: "center" }} />
        <p style={{ wordBreak: "break-all" }}>{invitation.link}</p>
        <Button variant="secondary" onClick={() => { void copyText(invitation.link).then(ok => setCopied(ok ? "Link kopiert." : "Kopieren nicht möglich.")); }}>Link kopieren</Button>
        {copied ? <p role="status">{copied}</p> : null}
        <p className="ow-muted">Der Link wird nur jetzt angezeigt. Geht er verloren: widerrufen und neu einladen.</p>
      </div> : null}
    </Sheet>

    <Sheet open={!!codes} onClose={() => setCodes(null)} title="Aktivierungscodes">
      {codes ? <div style={{ display: "grid", gap: 12 }}>
        <p className="ow-muted">Nur jetzt sichtbar. Auf die Karten für die Boxen drucken; verloren: neuen Code erzeugen.</p>
        <table><thead><tr><th scope="col" style={{ textAlign: "left" }}>Platte</th><th scope="col" style={{ textAlign: "left" }}>Code</th></tr></thead>
          <tbody>{codes.map(c => <tr key={c.plateLabel}><td>{c.plateLabel}</td><td style={{ fontFamily: "ui-monospace, monospace", letterSpacing: ".05em" }}>{c.code}</td></tr>)}</tbody></table>
        <Button variant="secondary" onClick={() => window.print()}>Drucken</Button>
      </div> : null}
    </Sheet>

    <Sheet open={!!prog} onClose={closeEnd} title="Enddatum">
      {prog ? <div style={{ display: "grid", gap: 12 }}>
        <p><strong>{prog.tenant}</strong> · {prog.location} · {prog.programme}</p>
        <p>Jetzt: <strong>{endText(prog)}</strong></p>
        <TextField label="Letzter Tag" type="date" min={earliestEndDate(new Date())} value={endDate} hint={prog.nextEnd ? `Nächstes mögliches Ende: ${germanDate(prog.nextEnd)}` : undefined} onChange={event => { setEndDate(event.target.value); setEndPreview(null); setSheetError(""); }} />
        {endPreview ? <p role="status">Von <strong>{endText(prog)}</strong> zu <strong>bestätigt bis {germanDate(endPreview.endDate ?? endDate)}</strong></p> : null}
        {sheetError ? <p role="alert">{sheetError}</p> : null}
        {endPreview ? <Button loading={busy} onClick={() => sendEnd(true)}>Bestätigen</Button>
          : <Button loading={busy} disabled={!endDate} onClick={() => sendEnd(false)}>Prüfen</Button>}
      </div> : null}
    </Sheet>

    <Sheet open={!!ending} onClose={closeSheets} title={ending?.acknowledged ? "Enddatum ändern" : "Enddatum"}>
      {ending ? <div style={{ display: "grid", gap: 12 }}>
        <p><strong>{ending.tenant}</strong> · {ending.locations.join(", ")}</p>
        <p className="ow-muted">Jetzt: {ending.badge}{ending.requestedOn ? ` · angefragt am ${ending.requestedOn}` : ""} · Abrechnung am {ending.anchorDay}.</p>
        <fieldset style={{ display: "grid", gap: 8, border: 0, margin: 0, padding: 0 }}>
          <legend className="ow-muted">Letzter Tag</legend>
          {ending.choices.filter(c => !c.consent).map(c => <label key={c.endDate} style={{ display: "flex", gap: 8, alignItems: "baseline", minHeight: 44 }}>
            <input type="radio" style={{ accentColor: "var(--color-action)" }} name="op-end" checked={choice === c.endDate} onChange={() => { setChoice(c.endDate); setConsent(false); setChecked(null); }} />{c.label}
          </label>)}
          {ending.choices.some(c => c.consent) ? <details open={picked?.consent === true}>
            <summary style={{ paddingBlock: "var(--space-3)", cursor: "pointer" }}>Späteres Ende (nur wenn das Geschäft zustimmt)</summary>
            {ending.choices.filter(c => c.consent).map(c => <label key={c.endDate} style={{ display: "flex", gap: 8, alignItems: "baseline", minHeight: 44 }}>
              <input type="radio" style={{ accentColor: "var(--color-action)" }} name="op-end" checked={choice === c.endDate} onChange={() => { setChoice(c.endDate); setConsent(false); setChecked(null); }} />{c.label}
            </label>)}
          </details> : null}
        </fieldset>
        {checked ? <div role="status" style={{ display: "grid", gap: 4, padding: 12, border: "1px solid var(--color-line, currentColor)", borderRadius: "var(--radius-md)" }}>
          <p>Von <strong>{ending.badge}</strong> zu <strong>bestätigt bis {checked.facts.lastDay.value}</strong></p>
          <p>Letzte Rechnung: {checked.facts.lastInvoice.value}</p>
          <p>Export bis {checked.facts.exportUntil.value}</p>
          {checked.endDate !== ending.endDate ? <p>Das Geschäft bekommt die Änderung per E-Mail.</p> : null}
          {checked.consent ? <Checkbox checked={consent} onChange={event => setConsent(event.target.checked)}>Das Geschäft hat diesem späteren Ende in Textform zugestimmt.</Checkbox> : null}
        </div> : null}
        {sheetError ? <p role="alert">{sheetError}</p> : null}
        {checked ? <Button loading={busy} disabled={checked.consent && !consent} onClick={() => void confirmEnd()}>Bestätigen</Button>
          : <Button loading={busy} disabled={!choice} onClick={() => void checkEnd()}>Prüfen</Button>}
        <Button variant="quiet" block onClick={() => { setWithdrawing(ending); setEnding(null); setSheetError(""); }}>Kündigung zurücknehmen (auf Wunsch des Geschäfts)</Button>
      </div> : null}
    </Sheet>

    <Sheet open={!!withdrawing} onClose={closeSheets} title="Kündigung zurücknehmen?">
      {withdrawing ? <div style={{ display: "grid", gap: 12 }}>
        <p>{withdrawing.withdrawal}</p>
        {sheetError ? <p role="alert">{sheetError}</p> : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button variant="secondary" onClick={closeSheets}>Abbrechen</Button><Button loading={busy} onClick={() => void withdraw()}>Zurücknehmen</Button></div>
      </div> : null}
    </Sheet>

    <Sheet open={!!entry} onClose={closeSheets} title="Kündigung per E-Mail eintragen">
      {entry ? <div style={{ display: "grid", gap: 12 }}>
        <p><strong>{entry.tenant}</strong> · {entry.location}</p>
        <TextField label="Eingang der E-Mail (deutsche Zeit)" type="datetime-local" max={berlinNow()} value={receivedAt} hint="Die Kündigung zählt ab dem Eingang der E-Mail, nicht ab jetzt. Sie gilt für alle Standorte des Geschäfts." onChange={event => { setReceivedAt(event.target.value); setEntryEnd(null); setPastEnd(false); setAcceptPast(false); }} />
        {pastEnd ? <div style={{ display: "grid", gap: 4 }}>
          <p role="alert" style={{ display: "flex", gap: 8, alignItems: "baseline" }}><AlertCircle size={16} aria-hidden="true" style={{ flex: "none", color: "var(--color-warning)", alignSelf: "center" }} />{`Diese E-Mail kam vor mehr als 14 Tagen an. Die Kündigung gilt ab ihrem Eingang am ${receivedAt.slice(0, 10).split("-").reverse().join(".")}; das Vertragsende kann schon vorbei sein. Prüfe, ob das Geschäft sie inzwischen zurückgenommen hat, und trage sie mit dem Eingangsdatum ein.`}</p>
          <Checkbox checked={acceptPast} onChange={event => setAcceptPast(event.target.checked)}>Eingang geprüft, nicht zurückgenommen: mit Eingangsdatum eintragen</Checkbox>
        </div> : null}
        {receivedAt > berlinNow() ? <p role="alert">{FUTURE_RECEIPT}</p> : null}
        {/* Design (blocking 5): an end that has already passed is said plainly, in the danger tone; final copy comes with ENG-167c. */}
        {entryEnd ? entryEnd.past
          ? <p role="alert" style={{ display: "flex", gap: 8, alignItems: "baseline", color: "var(--color-danger)" }}><AlertCircle size={16} aria-hidden="true" style={{ flex: "none", alignSelf: "center" }} />Endet am {germanDate(entryEnd.endDate)}. Das Datum ist schon vorbei.</p>
          : <p role="status">Endet am <strong>{germanDate(entryEnd.endDate)}</strong>. Das Geschäft bekommt die Bestätigung per E-Mail.</p> : null}
        {entryEnd?.facts ? <dl style={{ display: "grid", gap: 4, margin: 0 }}>{[entryEnd.facts.lastDay, entryEnd.facts.lastInvoice, entryEnd.facts.exportUntil].map(fact => <div key={fact.label}><dt className="ow-muted" style={{ display: "inline" }}>{fact.label}: </dt><dd style={{ display: "inline", margin: 0 }}>{fact.value}</dd></div>)}</dl> : null}
        {sheetError ? <p role="alert">{sheetError}</p> : null}
        {entryEnd ? <Button variant={entryEnd.past ? "danger" : "primary"} loading={busy} onClick={() => void checkEntry(true)}>{entryEnd.past ? "Trotzdem eintragen" : "Eintragen"}</Button>
          : <Button loading={busy} disabled={!receivedAt || receivedAt > berlinNow() || (pastEnd && !acceptPast)} onClick={() => void checkEntry(false)}>Prüfen</Button>}
      </div> : null}
    </Sheet>

    <Sheet open={!!tplRow} onClose={closeTemplate} title="Apple-Wallet-Vorlage">
      {tplRow ? <div style={{ display: "grid", gap: 12 }}>
        <p><strong>{tplRow.tenant}</strong> · {tplRow.location}</p>
        <p>Jetzt: <strong>{templateText(tplRow.walletTemplate)}</strong></p>
        <TextField label="Vorlagen-ID aus PassFast (veröffentlicht)" placeholder="00000000-0000-4000-8000-000000000000" value={templateId} onChange={event => { setTemplateId(event.target.value); setTplPreview(null); }} autoComplete="off" spellCheck={false} />
        {tplRow.walletTemplate ? <p className="ow-muted">Wallet-Karten, die mit der alten Vorlage ausgestellt wurden, bekommen nach der Änderung keine Aktualisierung mehr (Stempel, Prämien, Nachrichten). Das ist wie bisher bei einer Änderung in Railway.</p> : null}
        {tplPreview ? <p role="status">Von <strong>{tplPreview.from ?? "keine"}</strong> zu <strong>{tplPreview.to}</strong>{tplPreview.result === "unchanged" ? " (keine Änderung)" : ""} · Apple Wallet {tplPreview.ready ? "bereit" : "noch nicht bereit (PassFast aus oder unvollständig)"}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {tplPreview && tplPreview.result !== "unchanged"
          ? <Button loading={busy} onClick={() => sendTemplate(true)}>Bestätigen</Button>
          : <Button loading={busy} disabled={!templateId.trim()} onClick={() => sendTemplate(false)}>Prüfen</Button>}
      </div> : null}
    </Sheet>

    <Sheet open={!!plate} onClose={close} title={`Platte ${label ?? ""}`}>
      {plate ? <div style={{ display: "grid", gap: 12 }}>
        <p>Jetzt: <strong>{plate.programId ? shopText({ merchant: plate.merchant!, location: plate.location!, programme: plate.programme! }) : "frei"}</strong></p>
        {plate.status === "unlinked" || plate.status === "active" ? <>
          <Select label="Programm" value={programId} onChange={event => { setProgramId(event.target.value); setPreview(null); }}>
            <option value="">Bitte wählen</option>
            {linkable.map(r => <option key={r.programId} value={r.programId}>{r.tenant} · {r.location} · {r.programme}</option>)}
          </Select>
          {preview ? <p role="status">Von <strong>{shopText(preview.from)}</strong> zu <strong>{shopText(preview.to)}</strong>{preview.result === "unchanged" ? " (keine Änderung)" : ""}</p> : null}
          {error ? <p role="alert">{error}</p> : null}
          {preview && preview.result !== "unchanged"
            ? <Button loading={busy} onClick={() => send(preview.to ? programId : null, true)}>Bestätigen</Button>
            : <Button loading={busy} disabled={!programId} onClick={() => send(programId, false)}>{plate.programId ? "Neu verknüpfen" : "Verknüpfen"}</Button>}
          {plate.programId && !preview ? <Button variant="danger" loading={busy} onClick={() => { setProgramId(""); send(null, false); }}>Verknüpfung lösen</Button> : null}
        </> : <p className="ow-muted">Diese Platte ist {STATUS[plate.status] ?? plate.status} und kann nicht verknüpft werden.</p>}
        {plate.status === "unlinked" ? <>
          <p>Aktivierungscode: <strong>{CODE[plate.code]}</strong></p>
          {plate.alertedAt ? <p role="status">Am {date(plate.alertedAt)} kamen mehr als 50 Versuche in einer Stunde, von mehreren Konten. Nichts ist gesperrt; im Zweifel einen neuen Code erzeugen.</p> : null}
          {plate.code === "locked" ? <Button variant="secondary" loading={busy} onClick={() => void sendCodes({ action: "unlock", plateLabel: plate.plateLabel })}>Sperre aufheben</Button> : null}
          <Button variant="quiet" loading={busy} onClick={() => void sendCodes({ action: "issue", plateLabels: [plate.plateLabel] })}>{plate.code === "none" ? "Code erzeugen" : "Neuen Code erzeugen (alter gilt nicht mehr)"}</Button>
        </> : null}
      </div> : null}
    </Sheet>
  </main>;
}
