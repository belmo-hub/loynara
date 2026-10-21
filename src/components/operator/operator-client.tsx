"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import QRCode from "qrcode";
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
type Plate = { plateLabel: string | null; status: string; everTapped: boolean; code: "none" | "open" | "locked" | "used"; programId: string | null; merchant: string | null; location: string | null; programme: string | null };
type Shop = { merchant: string; location: string; programme: string } | null;
type EndPreview = { result: string; end: string | null; endDate?: string };
type Preview = { result: string; plateLabel: string; from: Shop; to: Shop };
type Awaiting = { tenantId: string; tenant: string; location: string; city: string; inviteId: string; email: string; expiresAt: Date | string; status: "pending" | "accepted" | "revoked" | "expired" };
type Invitation = { tenant: string; email: string; link: string; qr: string; expiresAt: string };
const INVITE_STATUS = { pending: "Einladung offen", accepted: "Konto angelegt, Einrichtung offen", revoked: "Einladung widerrufen", expired: "Einladung abgelaufen" } as const;

const shopText = (shop: Shop) => shop ? `${shop.merchant} · ${shop.location} · ${shop.programme}` : "frei";
const date = (value: Date | string | null) => value ? new Date(value).toLocaleDateString("de-DE") : "noch keine";
const STATUS: Record<string, string> = { unlinked: "frei", active: "verknüpft", revoked: "gesperrt", replaced: "ersetzt" };
const CODE = { none: "kein Code", open: "Code offen", locked: "Code gesperrt", used: "Code benutzt" } as const;

export function OperatorClient({ rows, plates, awaiting }: { rows: Row[]; plates: Plate[]; awaiting: Awaiting[] }) {
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
  const [shopError, setShopError] = useState("");
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [copied, setCopied] = useState("");
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
    const element = event.currentTarget, form = new FormData(element);
    const text = (key: string) => String(form.get(key) ?? "").trim();
    if (await shop({ action: "create", businessName: text("businessName"), ...(text("locationName") ? { locationName: text("locationName") } : {}), city: text("city"), country: text("country"), timezone: text("timezone"), ownerEmail: text("ownerEmail") }, text("businessName"))) element.reset();
  }

  return <main className="ow-page" id="ow-main">
    <PageHeader title="Operator" description="Platten und Geschäfte. Nur für dich sichtbar." />
    {error && !label ? <p role="alert">{error}</p> : null}

    <Card as="section" aria-labelledby="op-new">
      <CardHeader id="op-new" title="Neues Geschäft" description="Legt Geschäft und Standort an und erstellt eine Einladung für die Inhaberin oder den Inhaber. Sie gilt 7 Tage und nur einmal. Das Passwort wählt die Person selbst." />
      <form onSubmit={createShop} style={{ display: "grid", gap: 8 }}>
        <TextField label="Geschäftsname" name="businessName" required minLength={2} maxLength={180} autoComplete="off" />
        <TextField label="Standort (optional)" name="locationName" minLength={2} maxLength={180} autoComplete="off" hint="Leer lassen: wie der Geschäftsname." />
        <TextField label="Stadt" name="city" required minLength={2} maxLength={120} autoComplete="off" />
        <Select label="Land" name="country" defaultValue="DE"><option value="DE">Deutschland</option><option value="MA">Marokko</option></Select>
        <Select label="Zeitzone" name="timezone" defaultValue="Europe/Berlin"><option value="Europe/Berlin">Europe/Berlin</option><option value="Africa/Casablanca">Africa/Casablanca</option></Select>
        <TextField label="E-Mail der Inhaberin oder des Inhabers" name="ownerEmail" type="email" required maxLength={320} autoComplete="off" hint="Die Einladung gilt nur für diese Adresse." />
        {shopError && !invitation ? <p role="alert">{shopError}</p> : null}
        <Button type="submit" loading={busy}>Geschäft anlegen und einladen</Button>
      </form>
      {awaiting.length ? <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }} aria-label="Geschäfte ohne Programm">
        {awaiting.map(a => <li key={a.tenantId} style={{ display: "grid", gap: 4, paddingTop: 8, borderTop: "1px solid var(--color-line, currentColor)" }}>
          <span><strong>{a.tenant}</strong> · {a.location} ({a.city})</span>
          <span className="ow-muted">{INVITE_STATUS[a.status]} · {a.email}{a.status === "pending" ? ` · gültig bis ${date(a.expiresAt)}` : ""}</span>
          {a.status === "pending" ? <Button variant="danger" loading={busy} onClick={() => void shop({ action: "revoke", inviteId: a.inviteId }, a.tenant)}>Einladung widerrufen</Button>
            : a.status !== "accepted" ? <Button variant="secondary" loading={busy} onClick={() => void shop({ action: "reissue", tenantId: a.tenantId, ownerEmail: a.email }, a.tenant)}>Neue Einladung an {a.email}</Button> : null}
        </li>)}
      </ul> : null}
    </Card>

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
      {withoutCode.length ? <Button variant="secondary" loading={busy} onClick={() => void sendCodes({ action: "issue", plateLabels: withoutCode })}>Aktivierungscodes für {withoutCode.length} freie {withoutCode.length === 1 ? "Platte" : "Platten"} erzeugen</Button> : null}
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
              {p.status === "unlinked" || p.code !== "none" ? <Badge tone={p.code === "locked" ? "warning" : "neutral"}>{CODE[p.code]}</Badge> : null}
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

    <Sheet open={!!invitation} onClose={() => setInvitation(null)} title="Einladung">
      {invitation ? <div style={{ display: "grid", gap: 12 }}>
        <p><strong>{invitation.tenant}</strong> · für {invitation.email} · gültig bis {date(invitation.expiresAt)}</p>
        <Image unoptimized src={invitation.qr} alt={`QR-Code der Einladung für ${invitation.tenant}`} width={240} height={240} style={{ justifySelf: "center" }} />
        <p style={{ wordBreak: "break-all" }}>{invitation.link}</p>
        <Button variant="secondary" onClick={() => { void navigator.clipboard.writeText(invitation.link).then(() => setCopied("Link kopiert."), () => setCopied("Kopieren nicht möglich.")); }}>Link kopieren</Button>
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
        {plate.status === "unlinked" ? <>
          <p>Aktivierungscode: <strong>{CODE[plate.code]}</strong></p>
          {plate.code === "locked" ? <Button variant="secondary" loading={busy} onClick={() => void sendCodes({ action: "unlock", plateLabel: plate.plateLabel })}>Sperre aufheben</Button> : null}
          <Button variant="quiet" loading={busy} onClick={() => void sendCodes({ action: "issue", plateLabels: [plate.plateLabel] })}>{plate.code === "none" ? "Code erzeugen" : "Neuen Code erzeugen (alter gilt nicht mehr)"}</Button>
        </> : null}
      </div> : null}
    </Sheet>
  </main>;
}
