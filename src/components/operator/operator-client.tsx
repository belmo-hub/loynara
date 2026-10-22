"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ScanLine } from "lucide-react";
import { QrScanner } from "@/components/qr-scanner";
import { ClientApiError, postJson } from "@/components/client-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { TextField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { earliestEndDate, END_DATE_TOO_EARLY } from "@/lib/operator-date";
import { germanDate } from "@/lib/programme-end-date";
import { plateLabelFromScan } from "./plate-scan";

type Row = { walletMessages: { messages: number; sent: number; removed: number; warn: boolean } | null; tenantId: string; tenant: string; weeklyReport: boolean; locationId: string; location: string; city: string; programId: string; programme: string; status: string; tapMode: string; cards: number; lastAward: Date | string | null; endDate: string | null; confirmed: boolean; requestedDays: number | null };
type Plate = { plateLabel: string | null; status: string; everTapped: boolean; programId: string | null; merchant: string | null; location: string | null; programme: string | null };
type Shop = { merchant: string; location: string; programme: string } | null;
type EndPreview = { result: string; end: string | null; endDate?: string };
type Preview = { result: string; plateLabel: string; from: Shop; to: Shop };
type Billing = { tenantId: string; tenant: string; status: string; planCode: string | null; currency: string };
type Guarantee = { locationId: string; tenant: string; location: string; customers: number | null; outcome: string | null; credited: boolean; decidedAt: Date | string | null };

const shopText = (shop: Shop) => shop ? `${shop.merchant} · ${shop.location} · ${shop.programme}` : "frei";
const date = (value: Date | string | null) => value ? new Date(value).toLocaleDateString("de-DE") : "noch keine";
const STATUS: Record<string, string> = { unlinked: "frei", active: "verknüpft", revoked: "gesperrt", replaced: "ersetzt" };

// „erreicht“: the location reached the start target, no credit. „nicht erreicht“: the month-2 credit is owed or issued.
const GUARANTEE_TEXT = (g: Guarantee) => g.outcome === "credit" ? (g.credited ? "Startgarantie nicht erreicht: Monat 2 kostenlos, Gutschrift erteilt" : "Startgarantie nicht erreicht: Gutschrift noch offen")
  : g.outcome === "reached" ? "Startgarantie erreicht" : g.outcome === "late" ? "Startgarantie zu spät entschieden, keine Gutschrift" : "Startgarantie entfällt (gekündigt, nicht bezahlt oder Vertrag nach Stichtag)";
const PLAN_TEXT: Record<string, string> = { founding: "Gründungspreis 39 €", list: "Listenpreis 49 €" };
const BILLING_STATUS: Record<string, string> = { manual_pending: "kein Abo", pending_checkout: "Checkout offen", active: "Abo aktiv", past_due: "Zahlung offen", suspended: "Abo ausgesetzt", cancelled: "Abo beendet" };

export function OperatorClient({ rows, plates, billing, guarantees }: { rows: Row[]; plates: Plate[]; billing: Billing[]; guarantees: Guarantee[] }) {
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
  const plate = plates.find(p => p.plateLabel === label);
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
    if (endDate < earliestEndDate(new Date())) { setError(END_DATE_TOO_EARLY); return; }
    setBusy(true); setError("");
    try {
      const result = await postJson<EndPreview>("/api/operator/programme", { programId: prog!.programId, endDate, execute });
      if (execute) { setProg(null); setEndPreview(null); router.refresh(); } else setEndPreview(result);
    } catch (cause) { setError(cause instanceof ClientApiError ? cause.message : "Das hat nicht geklappt."); }
    finally { setBusy(false); }
  }
  const openEnd = (row: Row) => { setProg(row); setEndDate(row.endDate ?? ""); setEndPreview(null); setError(""); };
  const closeEnd = () => { setProg(null); setEndPreview(null); setError(""); };
  // Unconfirmed first (a request nobody has answered), then by end date.
  const cancellations = rows.filter(r => r.status === "active" && r.endDate).sort((a, b) => Number(a.confirmed) - Number(b.confirmed) || a.endDate!.localeCompare(b.endDate!));
  const endText = (r: Row) => r.endDate ? `${r.confirmed ? "bestätigt" : "vorläufig"} bis ${germanDate(r.endDate)}` : "keine Kündigung";
  const origin = (r: Row) => r.requestedDays !== null ? `angefragt vor ${r.requestedDays} ${r.requestedDays === 1 ? "Tag" : "Tagen"}` : "vom Operator geplant";
  const close = () => { setLabel(null); setPreview(null); setError(""); };
  async function setPlan(tenantId: string, planCode: string) {
    setBusy(true); setError("");
    try { await postJson("/api/operator/billing-plan", { tenantId, planCode }); router.refresh(); }
    catch (cause) { setError(cause instanceof ClientApiError ? cause.message : "Das hat nicht geklappt."); }
    finally { setBusy(false); }
  }

  return <main className="ow-page" id="ow-main">
    <PageHeader title="Operator" description="Platten und Geschäfte. Nur für dich sichtbar." />
    {error && !label ? <p role="alert">{error}</p> : null}

    {cancellations.length ? <Card as="section" aria-labelledby="op-cancel">
      <CardHeader id="op-cancel" title="Kündigungen" description="Vorläufige Termine zuerst. Ohne Bestätigung endet nichts." />
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {cancellations.map(r => <li key={r.programId} style={{ display: "grid", gap: 4 }}>
          <span><strong>{r.tenant}</strong> · {r.location} · {r.programme}</span>
          <span className="ow-muted">{origin(r)} · <Badge tone={r.confirmed ? "success" : "warning"}>{endText(r)}</Badge></span>
          <Button variant={r.confirmed ? "secondary" : "primary"} onClick={() => openEnd(r)}>{r.confirmed ? "Datum ändern" : "Datum bestätigen"}</Button>
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
      <CardHeader id="op-billing" title="Tarife" description="Gilt ab dem nächsten Checkout. Während ein Abo läuft, bleibt der Tarif fest." />
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {billing.filter(b => b.currency === "EUR").map(b => <li key={b.tenantId} style={{ display: "grid", gap: 4 }}>
          <span><strong>{b.tenant}</strong> · <Badge tone={b.status === "active" ? "success" : "neutral"}>{BILLING_STATUS[b.status] ?? b.status}</Badge></span>
          <Select label={`Tarif für ${b.tenant}`} value={b.planCode ?? ""} disabled={busy} onChange={event => { if (event.target.value) void setPlan(b.tenantId, event.target.value); }}>
            <option value="">Noch nicht gewählt</option>
            {Object.entries(PLAN_TEXT).map(([code, text]) => <option key={code} value={code}>{text}</option>)}
          </Select>
        </li>)}
      </ul>
    </Card>

    <Card as="section" aria-labelledby="op-plates">
      <CardHeader id="op-plates" title="Platten" action={<Button icon={<ScanLine size={18} />} onClick={() => setScanning(s => !s)}>Platte scannen</Button>} />
      {scanning ? <QrScanner onDetected={open} onClose={() => setScanning(false)} /> : null}
      <form onSubmit={event => { event.preventDefault(); open(typed); }} style={{ display: "flex", gap: 8, alignItems: "end" }}>
        <TextField label="Plattenname" placeholder="P-007" value={typed} onChange={event => setTyped(event.target.value)} autoCapitalize="characters" autoComplete="off" style={{ flex: 1 }} />
        <Button type="submit" variant="secondary">Öffnen</Button>
      </form>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {plates.map(p => <li key={p.plateLabel}>
          <button type="button" onClick={() => open(p.plateLabel!)} style={{ width: "100%", minHeight: 56, textAlign: "left", display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", padding: "8px 12px", background: "transparent", border: "1px solid var(--color-line, currentColor)", borderRadius: "var(--radius-md)", color: "inherit", font: "inherit" }}>
            <span><strong>{p.plateLabel}</strong><br /><span className="ow-muted">{p.programId ? shopText({ merchant: p.merchant!, location: p.location!, programme: p.programme! }) : "frei"}</span></span>
            <span style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <Badge tone={p.status === "active" ? "success" : "neutral"}>{STATUS[p.status] ?? p.status}</Badge>
              <Badge>{p.everTapped ? "getippt" : "nie getippt"}</Badge>
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
          <span className="ow-muted">{r.programme} · {r.status === "active" ? "aktiv" : "archiviert"} · {r.cards} Karten · letzte Gutschrift: {date(r.lastAward)} · Wochenbericht {r.weeklyReport ? "an" : "aus"}{r.endDate ? ` · Kündigung ${origin(r)}, ${endText(r)}` : ""}</span>
          {r.walletMessages ? <><br /><span className={r.walletMessages.warn ? undefined : "ow-muted"} role={r.walletMessages.warn ? "alert" : undefined}>Wallet-Nachrichten (30 Tage): {r.walletMessages.messages} gesendet an {r.walletMessages.sent} Karten · Karten entfernt innerhalb von 48 Stunden: {r.walletMessages.removed}{r.walletMessages.warn ? " · Warnung: mehr Karten entfernt als erwartet" : ""}</span></> : null}
          {r.status === "active" ? <div><Button variant="quiet" onClick={() => openEnd(r)}>{r.endDate ? "Enddatum ändern" : "Enddatum setzen"}</Button></div> : null}
        </li>)}
      </ul>
    </Card>

    <Sheet open={!!prog} onClose={closeEnd} title="Enddatum">
      {prog ? <div style={{ display: "grid", gap: 12 }}>
        <p><strong>{prog.tenant}</strong> · {prog.location} · {prog.programme}</p>
        <p>Jetzt: <strong>{endText(prog)}</strong></p>
        <TextField label="Letzter Tag" type="date" min={earliestEndDate(new Date())} value={endDate} onChange={event => { setEndDate(event.target.value); setEndPreview(null); }} />
        {endPreview ? <p role="status">Von <strong>{endText(prog)}</strong> zu <strong>bestätigt bis {germanDate(endPreview.endDate ?? endDate)}</strong></p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {endPreview ? <Button loading={busy} onClick={() => sendEnd(true)}>Bestätigen</Button>
          : <Button loading={busy} disabled={!endDate} onClick={() => sendEnd(false)}>Prüfen</Button>}
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
      </div> : null}
    </Sheet>
  </main>;
}
