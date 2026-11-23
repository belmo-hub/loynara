"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDay } from "@/components/booking/booking-format";
import { apiJson, ClientApiError, newRequestId, postJson } from "@/components/client-api";
import { actionError, longDate, shiftDate, todayIn, wallTime, type DayResponse, type OwnerAppointment } from "./booking-day-model";
import { LoadingBlock, OwnerDialog } from "./owner-ui";
import { useLoad } from "./use-load";

type Slot = { start: string; staffId: string };
type Slots = { staff: Array<{ id: string; name: string }>; slots: Slot[] };
const failure = (cause: unknown) => cause instanceof ClientApiError ? { code: cause.code, status: cause.status, message: cause.message } : {};
/** „Mi 25.11.“ for the primary button (Design, 24 Nov). */
const shortDay = (date: string) => {
  const at = new Date(`${date}T12:00:00Z`);
  return `${new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone: "UTC" }).format(at).replace(".", "")} ${date.slice(8, 10)}.${date.slice(5, 7)}.`;
};

/** D4: one tap to the next day with a free time when the picked one is full; it looks the day up once on mount. */
export function NextFreeDay({ find, onPick }: { find: () => Promise<string | null>; onPick: (date: string) => void }) {
  const [date, setDate] = useState<string | null | undefined>(undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { let live = true; void find().then(found => { if (live) setDate(found); }); return () => { live = false; }; }, []);
  if (date === undefined) return <LoadingBlock rows={1} height={44} />;
  if (date === null) return <p className="ow-muted">In den nächsten vier Wochen ist nichts frei.</p>;
  return <div><button type="button" className="ow-btn ow-btn--secondary" onClick={() => onPick(date)} data-autofocus>Nächster freier Tag: {formatDay(date)}</button></div>;
}

/**
 * ENG-372 (founder Q-116 c): a caller's appointment, entered by the shop. Only for a card found by its number; the name
 * starts from the card's last booking here. No phone field and no new data: only what a booking already holds.
 * Each step has its own view, so the dialog moves focus to it (Design, 24 Nov).
 */
export function NewAppointmentDialog({ day, services, onClose, onBooked }: { day: DayResponse; services: Array<{ id: string; name: string }>; onClose: () => void; onBooked: (text: string, row: OwnerAppointment, date: string) => void }) {
  const zone = day.timezone;
  const [key] = useState(newRequestId);
  const [number, setNumber] = useState("");
  const [tries, setTries] = useState(0);
  const [card, setCard] = useState<{ cardLocator: string; name: string | null } | null>(null);
  const [name, setName] = useState("");
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [date, setDate] = useState(day.date < todayIn(zone) ? todayIn(zone) : day.date);
  const [staffId, setStaffId] = useState("");
  const [picked, setPicked] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const slotsUrl = (target: string) => `/api/merchant/booking/caller/slots?serviceId=${serviceId}&date=${target}`;
  const [loaded] = useLoad<Slots>(card && serviceId ? slotsUrl(date) : null);
  const slots = loaded.state === "ok" ? loaded.data : null;
  const staffName = (id: string) => slots?.staff.find(member => member.id === id)?.name ?? "";
  const shown = slots?.slots.filter(slot => !staffId || slot.staffId === staffId) ?? [];

  async function find() {
    setBusy(true); setError("");
    try { const found = await apiJson<{ cardLocator: string; name: string | null }>(`/api/merchant/booking/caller?card=${encodeURIComponent(number.trim())}`); setCard(found); setName(found.name ?? ""); }
    catch (cause) { setError(cause instanceof ClientApiError && cause.status === 404 ? cause.message : actionError(failure(cause))); setTries(count => count + 1); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!card || !picked) return;
    setBusy(true); setError("");
    try {
      const row = await postJson<OwnerAppointment>("/api/merchant/booking/caller", { card: card.cardLocator, serviceId, staffId: picked.staffId, start: picked.start, customerName: name.trim(), idempotencyKey: key });
      onBooked(`${name.trim()}: ${longDate(date).replace(/(\d+\.) /, "$1\u00a0")}, ${wallTime(picked.start, zone)} Uhr bei ${staffName(picked.staffId)} eingetragen.`, row, date);
    } catch (cause) { setError(actionError(failure(cause))); }
    finally { setBusy(false); }
  }
  // One request for 28 days (Design r2): the server reads them in one pass.
  const firstFree = async (from: string) => (await apiJson<{ date: string | null }>(`/api/merchant/booking/caller/next-free?serviceId=${serviceId}&from=${from}${staffId ? `&staffId=${staffId}` : ""}`).catch(() => ({ date: null }))).date;
  const choose = (next: { date?: string; staffId?: string; serviceId?: string }) => {
    if (next.date !== undefined) setDate(next.date);
    if (next.staffId !== undefined) setStaffId(next.staffId);
    if (next.serviceId !== undefined) setServiceId(next.serviceId);
    setPicked(null);
  };

  const cancel = <button type="button" className="ow-btn ow-btn--ghost" onClick={onClose} disabled={busy}>Abbrechen</button>;
  if (!card) return (
    <OwnerDialog view={`card:${tries}`} title="Termin eintragen" onClose={onClose} actions={<>{cancel}<button type="button" className="ow-btn ow-btn--primary" onClick={() => void find()} disabled={busy || !number.trim()} aria-busy={busy}>Karte suchen</button></>}>
      <p>Frag nach der Kartennummer. Sie steht auf der Karte unter dem QR-Code.</p>
      <div className="ow-field"><label htmlFor="bn-card">Kartennummer</label>
        <input id="bn-card" className="ow-input" autoComplete="off" autoCapitalize="characters" spellCheck={false} translate="no" value={number} onChange={event => setNumber(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && number.trim()) void find(); }}
          aria-invalid={error ? true : undefined} aria-describedby={error ? "bn-card-error" : "bn-card-hint"} data-autofocus />
        <span id="bn-card-hint" className="ow-hint">z. B. K-7Q4M2X</span></div>
      {error && <p id="bn-card-error" className="ow-error" role="alert">{error}</p>}
    </OwnerDialog>
  );

  const multi = (slots?.staff.length ?? 0) > 1;
  const when = picked ? `${shortDay(date)}, ${wallTime(picked.start, zone)} Uhr bei ${staffName(picked.staffId)}` : "";
  return (
    <OwnerDialog view="slots" title="Termin eintragen" scroll onClose={onClose} actions={<>{cancel}<button type="button" className="ow-btn ow-btn--primary" onClick={() => void save()} disabled={busy || !picked || !name.trim()} aria-busy={busy}>
      {/* Narrow or at large text the button says „Eintragen“ and the summary line above it names when (Design r2). */}
      {picked ? <><span className="ow-caller-long">{when} eintragen</span><span className="ow-caller-short">Eintragen<span className="ow-sr">, {when}</span></span></> : "Eintragen"}</button>
      {/* Last in the reversed-wrap action row, so it stands right above the buttons. */}
      {/* Seen only narrow; the short label carries the same words for a screen reader, so they are read once. */}
      {picked && <p className="ow-caller-summary" aria-hidden="true">{when}</p>}</>}>
      <div className="ow-row" style={{ justifyContent: "space-between" }}><p className="ow-hint" translate="no">Karte {card.cardLocator}</p>
        <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" onClick={() => { setCard(null); setPicked(null); setError(""); }} disabled={busy}>Andere Karte</button></div>
      <div className="ow-field"><label htmlFor="bn-name">Name</label><input id="bn-name" className="ow-input" autoComplete="off" maxLength={60} value={name} onChange={event => setName(event.target.value)} data-autofocus /></div>
      {services.length === 0 ? <><p>Lege zuerst eine Leistung an, dann kannst du Termine eintragen.</p><div><Link className="ow-btn ow-btn--secondary" href="/merchant/termine/einrichten">Leistung anlegen</Link></div></> : <>
        {services.length > 1 && <div className="ow-field"><label htmlFor="bn-service">Leistung</label><select id="bn-service" className="ow-select" value={serviceId} onChange={event => choose({ serviceId: event.target.value })}>{services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
        <div className="ow-field"><label htmlFor="bn-date">Tag</label><input id="bn-date" type="date" className="ow-input" value={date} min={todayIn(zone)} onChange={event => { if (event.target.value) choose({ date: event.target.value }); }} /></div>
        {multi && <div className="ow-field"><span className="ow-label" id="bn-staff">Bei</span>
          <div className="ow-seg" role="group" aria-labelledby="bn-staff"><button type="button" aria-pressed={!staffId} onClick={() => choose({ staffId: "" })}>Alle</button>{slots!.staff.map(member => <button key={member.id} type="button" aria-pressed={staffId === member.id} onClick={() => choose({ staffId: member.id })}>{member.name}</button>)}</div></div>}
        <span className="ow-label" id="bn-slots">Freie Zeiten</span>
        {loaded.state === "error" ? <p className="ow-error" role="alert">Freie Zeiten nicht geladen. Wähle den Tag neu.</p>
          : slots === null ? <LoadingBlock rows={1} height={44} />
          : shown.length === 0 ? <><p className="ow-muted">{staffId ? `Bei ${staffName(staffId)} ist an diesem Tag nichts frei.` : "An diesem Tag ist nichts frei."}</p>
            <NextFreeDay key={`${date}:${staffId}:${serviceId}`} find={() => firstFree(shiftDate(date, 1))} onPick={target => choose({ date: target })} /></>
          : <div className="ow-row" role="group" aria-labelledby="bn-slots" style={{ gap: "var(--space-2)" }}>{shown.map(slot => <button key={`${slot.start}:${slot.staffId}`} type="button" className="ow-btn ow-btn--secondary ow-btn--sm ow-num ow-slot" aria-pressed={picked === slot} onClick={() => setPicked(slot)}>{wallTime(slot.start, zone)}{multi && !staffId && ` · ${staffName(slot.staffId)}`}</button>)}</div>}
      </>}
      {error && <p className="ow-error" role="alert">{error}</p>}
    </OwnerDialog>
  );
}
