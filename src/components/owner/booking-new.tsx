"use client";

import { useState } from "react";
import { apiJson, ClientApiError, newRequestId, postJson } from "@/components/client-api";
import { actionError, todayIn, wallTime, type DayResponse, type OwnerAppointment } from "./booking-day-model";
import { LoadingBlock, OwnerDialog } from "./owner-ui";
import { useLoad } from "./use-load";

type Slot = { start: string; staffId: string };
type Slots = { staff: Array<{ id: string; name: string }>; slots: Slot[] };
const failure = (cause: unknown) => cause instanceof ClientApiError ? { code: cause.code, status: cause.status, message: cause.message } : {};

/**
 * ENG-372 (founder Q-116 c): a caller's appointment, entered by the shop. Only for a card found by its number; the name
 * starts from the card's last booking here. No phone field and no new data: only what a booking already holds.
 */
export function NewAppointmentDialog({ day, services, onClose, onDone }: { day: DayResponse; services: Array<{ id: string; name: string }>; onClose: () => void; onDone: (text: string, tone: "ok", row: OwnerAppointment) => void }) {
  const zone = day.timezone;
  const [key] = useState(newRequestId);
  const [number, setNumber] = useState("");
  const [card, setCard] = useState<{ cardLocator: string; name: string | null } | null>(null);
  const [name, setName] = useState("");
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [date, setDate] = useState(day.date < todayIn(zone) ? todayIn(zone) : day.date);
  const [picked, setPicked] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [loaded] = useLoad<Slots>(card && serviceId ? `/api/merchant/booking/caller/slots?serviceId=${serviceId}&date=${date}` : null);
  const slots = loaded.state === "ok" ? loaded.data : null;

  async function find() {
    setBusy(true); setError("");
    try { const found = await apiJson<{ cardLocator: string; name: string | null }>(`/api/merchant/booking/caller?card=${encodeURIComponent(number.trim())}`); setCard(found); setName(found.name ?? ""); }
    catch (cause) { setError(cause instanceof ClientApiError && cause.status === 404 ? cause.message : actionError(failure(cause))); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!card || !picked) return;
    setBusy(true); setError("");
    try {
      const row = await postJson<OwnerAppointment>("/api/merchant/booking/caller", { card: card.cardLocator, serviceId, staffId: picked.staffId, start: picked.start, customerName: name.trim(), idempotencyKey: key });
      onDone(`${name.trim()}: ${wallTime(picked.start, zone)} Uhr eingetragen.`, "ok", row);
    } catch (cause) { setError(actionError(failure(cause))); }
    finally { setBusy(false); }
  }

  const cancel = <button type="button" className="ow-btn ow-btn--ghost" onClick={onClose} disabled={busy}>Abbrechen</button>;
  if (!card) return (
    <OwnerDialog view="form" title="Termin eintragen" onClose={onClose} actions={<>{cancel}<button type="button" className="ow-btn ow-btn--primary" onClick={() => void find()} disabled={busy || !number.trim()} aria-busy={busy}>Karte suchen</button></>}>
      <p>Für Kunden, die anrufen. Termine trägst du nur für eine Karte ein.</p>
      <div className="ow-field"><label htmlFor="bn-card">Kartennummer</label>
        <input id="bn-card" className="ow-input" autoComplete="off" autoCapitalize="characters" spellCheck={false} translate="no" value={number} onChange={event => setNumber(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && number.trim()) void find(); }} aria-describedby="bn-card-hint" data-autofocus />
        <span id="bn-card-hint" className="ow-hint">Steht auf der Karte unter dem QR-Code, z. B. K-7Q4M2X.</span></div>
      {error && <p className="ow-error" role="alert">{error}</p>}
    </OwnerDialog>
  );

  const staffName = (id: string) => slots?.staff.find(member => member.id === id)?.name ?? "";
  return (
    <OwnerDialog view="form" title="Termin eintragen" scroll onClose={onClose} actions={<>{cancel}<button type="button" className="ow-btn ow-btn--primary" onClick={() => void save()} disabled={busy || !picked || !name.trim()} aria-busy={busy}>{picked ? `Für ${wallTime(picked.start, zone)} Uhr eintragen` : "Eintragen"}</button></>}>
      <p className="ow-hint" translate="no">Karte {card.cardLocator}</p>
      <div className="ow-field"><label htmlFor="bn-name">Name</label><input id="bn-name" className="ow-input" autoComplete="off" maxLength={60} value={name} onChange={event => setName(event.target.value)} data-autofocus /></div>
      {services.length > 1 && <div className="ow-field"><label htmlFor="bn-service">Leistung</label><select id="bn-service" className="ow-select" value={serviceId} onChange={event => { setServiceId(event.target.value); setPicked(null); }}>{services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
      <div className="ow-field"><label htmlFor="bn-date">Tag</label><input id="bn-date" type="date" className="ow-input" value={date} min={todayIn(zone)} onChange={event => { if (event.target.value) { setDate(event.target.value); setPicked(null); } }} /></div>
      <span className="ow-label" id="bn-slots">Freie Zeiten</span>
      {loaded.state === "error" ? <p className="ow-error" role="alert">Freie Zeiten nicht geladen. Wähle den Tag neu.</p>
        : slots === null ? <LoadingBlock rows={1} height={44} />
        : slots.slots.length === 0 ? <p className="ow-muted">An diesem Tag ist nichts frei.</p>
        : <div className="ow-row" role="group" aria-labelledby="bn-slots" style={{ gap: "var(--space-2)" }}>{slots.slots.map(slot => <button key={`${slot.start}:${slot.staffId}`} type="button" className="ow-btn ow-btn--secondary ow-btn--sm ow-num" aria-pressed={picked === slot}
          style={picked === slot ? { borderColor: "var(--color-action)", background: "var(--color-action-soft)" } : undefined} onClick={() => setPicked(slot)}>{wallTime(slot.start, zone)}{slots.staff.length > 1 && ` · ${staffName(slot.staffId)}`}</button>)}</div>}
      {error && <p className="ow-error" role="alert">{error}</p>}
    </OwnerDialog>
  );
}
