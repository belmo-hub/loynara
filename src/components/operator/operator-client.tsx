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
import { germanDate } from "@/lib/programme-end-date";
import { plateLabelFromScan } from "./plate-scan";

type Row = { tenantId: string; tenant: string; weeklyReport: boolean; locationId: string; location: string; city: string; programId: string; programme: string; status: string; tapMode: string; cards: number; lastAward: Date | string | null; endDate: string | null; confirmed: boolean; requestedDays: number | null };
type Plate = { plateLabel: string | null; status: string; everTapped: boolean; programId: string | null; merchant: string | null; location: string | null; programme: string | null };
type Shop = { merchant: string; location: string; programme: string } | null;
type EndPreview = { result: string; end: string | null; endDate?: string };
type Preview = { result: string; plateLabel: string; from: Shop; to: Shop };

const shopText = (shop: Shop) => shop ? `${shop.merchant} · ${shop.location} · ${shop.programme}` : "frei";
const date = (value: Date | string | null) => value ? new Date(value).toLocaleDateString("de-DE") : "noch keine";
const STATUS: Record<string, string> = { unlinked: "frei", active: "verknüpft", revoked: "gesperrt", replaced: "ersetzt" };

export function OperatorClient({ rows, plates }: { rows: Row[]; plates: Plate[] }) {
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
          {r.status === "active" ? <div><Button variant="quiet" onClick={() => openEnd(r)}>{r.endDate ? "Enddatum ändern" : "Enddatum setzen"}</Button></div> : null}
        </li>)}
      </ul>
    </Card>

    <Sheet open={!!prog} onClose={closeEnd} title="Enddatum">
      {prog ? <div style={{ display: "grid", gap: 12 }}>
        <p><strong>{prog.tenant}</strong> · {prog.location} · {prog.programme}</p>
        <p>Jetzt: <strong>{endText(prog)}</strong></p>
        <TextField label="Letzter Tag" type="date" value={endDate} onChange={event => { setEndDate(event.target.value); setEndPreview(null); }} />
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
