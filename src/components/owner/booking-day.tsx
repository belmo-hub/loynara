"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiJson, ClientApiError, newRequestId, postJson } from "@/components/client-api";
import { EmptyState } from "@/components/ui/empty-state";
import { parsePurchaseAmountMinor } from "@/lib/points";
import { actionError, actionsFor, awardLine, dayName, dayRows, euroInput, longDate, shiftDate, STATUS_CHIP, STATUS_WORD, todayIn, wallTime, wallToIso, type DayBlock, type DayResponse, type OwnerAppointment } from "./booking-day-model";
import { useOwner } from "./owner-context";
import { ErrorNotice, LoadingBlock, Notice, OwnerDialog, OwnerIcon } from "./owner-ui";
import { useLoad } from "./use-load";

type Setup = { settings: { goalText: string } | null };
type Flash = { tone: "ok" | "danger" | "info"; text: string } | null;
const failure = (cause: unknown) => cause instanceof ClientApiError ? { code: cause.code, status: cause.status, message: cause.message } : {};
const BROWSER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function BookingDay() {
  const { me } = useOwner();
  const [setup, reloadSetup] = useLoad<Setup>("/api/merchant/booking/setup");
  // No date until the owner picks one: the server answers with the shop's today, never the device's.
  const [picked, setDate] = useState<string | null>(null);
  const [day, reload] = useLoad<DayResponse>(picked ? `/api/merchant/booking/day?date=${picked}` : "/api/merchant/booking/day");
  const [open, setOpen] = useState<OwnerAppointment | null>(null);
  const [blockOpen, setBlockOpen] = useState<DayBlock | "new" | null>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const timezone = day.state === "ok" ? day.data.timezone : BROWSER_ZONE;
  const today = todayIn(timezone);
  const date = picked ?? (day.state === "ok" ? day.data.date : today);
  const ready = setup.state === "ok" && setup.data.settings !== null;

  function done(text: string, tone: "ok" | "danger" | "info" = "ok") { setOpen(null); setBlockOpen(null); setFlash({ tone, text }); reload(); }

  return (
    <div className="ow-page">
      <header className="ow-pagehead">
        <div><p className="ow-eyebrow">Termine</p><h1>{dayName(date, today)}</h1><p>{longDate(date)}</p></div>
        {ready && day.state === "ok" && <div className="ow-row"><button type="button" className="ow-btn ow-btn--secondary" onClick={() => { setFlash(null); setBlockOpen("new"); }}>Zeit blocken</button></div>}
      </header>
      {ready && setup.data.settings?.goalText && <p className="ow-muted" style={{ marginTop: "calc(var(--space-4) * -1)" }}>Dein Ziel: {setup.data.settings.goalText}</p>}

      <nav className="ow-row" aria-label="Tag wählen" style={{ flexWrap: "nowrap", gap: "var(--space-1)" }}>
        <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" aria-label="Vorheriger Tag" onClick={() => setDate(shiftDate(date, -1))}>←</button>
        <div className="ow-seg" role="group" aria-label="Schnellwahl" style={{ flex: "1 1 auto", maxWidth: 360, justifyContent: "space-between" }}>
          {[-1, 0, 1].map(offset => { const target = shiftDate(today, offset); return <button key={offset} type="button" style={{ flex: 1 }} aria-pressed={date === target} onClick={() => setDate(target)}>{dayName(target, today)}</button>; })}
        </div>
        <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" aria-label="Nächster Tag" onClick={() => setDate(shiftDate(date, 1))}>→</button>
      </nav>

      {setup.state === "ok" && !setup.data.settings && (
        <Notice tone="info" actions={<Link className="ow-btn ow-btn--sm ow-btn--primary" href="/merchant/termine/einrichten">Jetzt einrichten</Link>}>Richte zuerst Leistungen und Zeiten ein.</Notice>
      )}
      {flash && <Notice tone={flash.tone} role={flash.tone === "danger" ? "alert" : "status"}>{flash.text}</Notice>}
      {day.state === "ok" && day.data.pendingRequests > 0 && <Notice tone="warn">{day.data.pendingRequests === 1 ? "1 offene Anfrage, ab heute." : `${day.data.pendingRequests} offene Anfragen, ab heute.`}</Notice>}

      {day.state === "error" ? <ErrorNotice message={day.status === 403 ? "Nur Inhaber und Leitung sehen die Termine." : "Die Termine konnten nicht geladen werden."} onRetry={reload} />
        : setup.state === "error" ? <ErrorNotice message="Die Einrichtung konnte nicht geladen werden." onRetry={reloadSetup} />
        : day.state !== "ok" || setup.state !== "ok" ? <LoadingBlock rows={3} height={56} />
        : ready && <DayList day={day.data} label={dayName(date, today)} onOpen={appointment => { setFlash(null); setOpen(appointment); }} onBlock={block => { setFlash(null); setBlockOpen(block); }} />}

      {open && day.state === "ok" && <AppointmentSheet appointment={open} day={day.data} programType={me?.programType ?? "stamp"} purchase={me?.earningMode === "purchase"} onClose={() => setOpen(null)} onDone={done}
        onAward={text => { done(text); window.setTimeout(() => setFlash(current => current?.text === text ? null : current), 2000); }} />}
      {blockOpen && day.state === "ok" && (blockOpen === "new"
        ? <BlockDialog day={day.data} onClose={() => setBlockOpen(null)} onDone={done} />
        : <ReleaseDialog block={blockOpen} onClose={() => setBlockOpen(null)} onDone={done} />)}
    </div>
  );
}

function DayList({ day, label, onOpen, onBlock }: { day: DayResponse; label: string; onOpen: (appointment: OwnerAppointment) => void; onBlock: (block: DayBlock) => void }) {
  const rows = dayRows(day);
  const staffName = (id: string | null) => id ? day.staff.find(s => s.id === id)?.name ?? "Mitarbeiter" : "Ganzer Laden";
  if (!rows.length) return <section className="ow-card"><EmptyState level={2} icon={<OwnerIcon name="calendar" size={24} />} title={`${label} keine Termine.`}>Kunden buchen über ihre Karte.</EmptyState></section>;
  return (
    <section className="ow-card" aria-label="Termine des Tages">
      <ul className="ow-members">{rows.map(row => row.kind === "block"
        ? <li key={row.block.id}><button type="button" className="ow-member" style={{ background: "var(--color-fill)" }} onClick={() => onBlock(row.block)}>
            <span className="ow-member-id"><strong className="ow-num">{wallTime(row.block.start, day.timezone)}–{wallTime(row.block.end, day.timezone)} · Geblockt</strong><small>{[row.block.reason, staffName(row.block.staffId)].filter(Boolean).join(" · ")}</small></span>
          </button></li>
        : <li key={row.appointment.id}><button type="button" className="ow-member" onClick={() => onOpen(row.appointment)}>
            <span className="ow-member-id"><strong><span className="ow-num">{wallTime(row.appointment.start, day.timezone)}</span> · {row.appointment.service.name}</strong><small>{row.appointment.customerName} · <span translate="no">{row.appointment.cardLocator}</span> · {row.appointment.staff.name}</small></span>
            <span className="ow-member-stat"><span className={STATUS_CHIP[row.appointment.status]} style={{ alignSelf: "flex-start" }}>{STATUS_WORD[row.appointment.status]}</span></span>
          </button></li>)}
      </ul>
    </section>
  );
}

type Mode = "main" | "cancel" | "move";

function AppointmentSheet({ appointment, day, programType, purchase, onClose, onDone, onAward }: { appointment: OwnerAppointment; day: DayResponse; programType: "stamp" | "points"; purchase: boolean; onClose: () => void; onDone: (text: string, tone?: "ok" | "danger" | "info") => void; onAward: (text: string) => void }) {
  const [mode, setMode] = useState<Mode>("main");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState(euroInput(appointment.priceMinor));
  const [reason, setReason] = useState("");
  const [moveDate, setMoveDate] = useState(day.date);
  const [slots, setSlots] = useState<Array<{ start: string; staffId: string }> | null>(null);
  const [slotError, setSlotError] = useState(false);
  const [picked, setPicked] = useState<{ start: string; staffId: string } | null>(null);
  const actions = actionsFor(appointment.status, appointment.start);
  const blocked = day.blockedMembershipIds.includes(appointment.membershipId);
  const zone = day.timezone, time = wallTime(appointment.start, zone);
  const pointsAmount = programType === "points" && purchase;
  let amountMinor: number | null = null;
  try { amountMinor = pointsAmount ? parsePurchaseAmountMinor(amount) : null; } catch { amountMinor = null; }

  useEffect(() => {
    if (mode !== "move") return;
    let live = true;
    void apiJson<{ slots: Array<{ start: string; staffId: string }> }>(`/api/merchant/booking/appointments/${appointment.id}/slots?date=${moveDate}`)
      .then(result => { if (live) { setSlots(result.slots); setSlotError(false); } }).catch(() => { if (live) setSlotError(true); });
    return () => { live = false; setSlots(null); setPicked(null); };
  }, [mode, moveDate, appointment.id]);

  async function run(call: () => Promise<unknown>, success: (result: never) => void) {
    setBusy(true); setError("");
    try { success(await call() as never); }
    catch (cause) {
      const info = failure(cause);
      if (info.code === "STALE" || info.code === "NOT_FOUND") { onDone(actionError(info), "info"); return; }
      if (info.code === "SLOT_TAKEN") setPicked(null);
      setError(actionError(info, appointment, zone));
    } finally { setBusy(false); }
  }
  const transition = (to: "confirmed" | "done" | "no_show" | "cancelled_by_shop", extra: object = {}) =>
    postJson<OwnerAppointment>(`/api/merchant/booking/appointments/${appointment.id}/transition`, { to, expected: appointment.status, idempotencyKey: newRequestId(), ...extra });

  const confirm = () => run(() => transition("confirmed"), () => onDone(`Termin ${time} bestätigt.`));
  const finish = () => run(() => transition("done", pointsAmount && amountMinor ? { purchaseAmountMinor: amountMinor } : {}),
    (result: OwnerAppointment) => onAward(result.doneAward ? awardLine(programType, result.doneAward.creditedQuantity) : "Termin erledigt."));
  const noShow = () => run(() => transition("no_show"), () => onDone(`${appointment.customerName}: nicht erschienen.`));
  const cancel = () => run(() => transition("cancelled_by_shop", reason.trim() ? { reason: reason.trim() } : {}), () => onDone(`Termin ${time} abgesagt.`));
  const move = () => picked && run(() => postJson(`/api/merchant/booking/appointments/${appointment.id}/move`, picked), () => onDone(`Termin verschoben auf ${dayName(moveDate, todayIn(zone))}, ${wallTime(picked.start, zone)} Uhr.`));
  const toggleBlock = () => run(() => postJson(`/api/merchant/booking/customers/${appointment.membershipId}/${blocked ? "unblock" : "block"}`, {}).catch(cause => {
    // The routes answer 204 without a body, which apiJson reads as an empty answer.
    if (cause instanceof ClientApiError && cause.status === 204) return; throw cause;
  }), () => onDone(blocked ? `${appointment.customerName} kann wieder online buchen.` : `${appointment.customerName} kann nicht mehr online buchen.`));

  const close = <button type="button" className="ow-btn ow-btn--ghost" onClick={mode === "main" ? onClose : () => { setMode("main"); setError(""); }} disabled={busy}>{mode === "main" ? "Schließen" : "Zurück"}</button>;
  const title = `${time} · ${appointment.service.name}`;

  if (mode === "cancel") return (
    <OwnerDialog title="Termin absagen?" tone="danger" onClose={onClose} actions={<>{close}<button type="button" className="ow-btn ow-btn--danger" onClick={() => void cancel()} disabled={busy} aria-busy={busy}>Absagen</button></>}>
      <p>{title} · {appointment.customerName}. Der Kunde sieht den Termin als abgesagt.</p>
      <div className="ow-field"><label htmlFor="bd-reason">Grund (optional)</label><input id="bd-reason" className="ow-input" maxLength={80} value={reason} onChange={event => setReason(event.target.value)} placeholder="z. B. Krankheit" data-autofocus /></div>
      {error && <p className="ow-error" role="alert">{error}</p>}
    </OwnerDialog>
  );

  if (mode === "move") return (
    <OwnerDialog title="Termin verschieben" onClose={onClose} actions={<>{close}<button type="button" className="ow-btn ow-btn--primary" onClick={() => void move()} disabled={busy || !picked} aria-busy={busy}>{picked ? `Auf ${wallTime(picked.start, zone)} Uhr verschieben` : "Verschieben"}</button></>}>
      <p>{title} · bei {appointment.staff.name}</p>
      <div className="ow-field"><label htmlFor="bd-move-date">Tag</label><input id="bd-move-date" type="date" className="ow-input" value={moveDate} min={todayIn(zone)} onChange={event => { if (event.target.value) setMoveDate(event.target.value); }} /></div>
      <span className="ow-label" id="bd-slots">Freie Zeiten</span>
      {slotError ? <p className="ow-error" role="alert">Freie Zeiten nicht geladen. Wähle den Tag neu.</p>
        : slots === null ? <LoadingBlock rows={1} height={44} />
        : slots.length === 0 ? <p className="ow-muted">An diesem Tag ist nichts frei.</p>
        : <div className="ow-row" role="group" aria-labelledby="bd-slots" style={{ gap: "var(--space-2)" }}>{slots.map(slot => <button key={slot.start} type="button" className="ow-btn ow-btn--secondary ow-btn--sm ow-num" aria-pressed={picked?.start === slot.start} style={picked?.start === slot.start ? { borderColor: "var(--color-action)", background: "var(--color-action-soft)" } : undefined} onClick={() => setPicked(slot)}>{wallTime(slot.start, zone)}</button>)}</div>}
      {error && <p className="ow-error" role="alert">{error}</p>}
    </OwnerDialog>
  );

  const primary = actions.includes("confirm") ? "confirm" : actions.includes("done") ? "done" : null;
  return (
    <OwnerDialog title={title} onClose={onClose} actions={<>{close}
      {primary === "confirm" && <button type="button" className="ow-btn ow-btn--primary" onClick={() => void confirm()} disabled={busy} aria-busy={busy} data-autofocus>Bestätigen</button>}
      {primary === "done" && <button type="button" className="ow-btn ow-btn--primary" onClick={() => void finish()} disabled={busy || (pointsAmount && !amountMinor)} aria-busy={busy} data-autofocus>Fertig</button>}
    </>}>
      <p>{appointment.customerName} · <span translate="no">{appointment.cardLocator}</span> · bei {appointment.staff.name}</p>
      <div className="ow-row"><span className={STATUS_CHIP[appointment.status]}>{STATUS_WORD[appointment.status]}</span>{appointment.customerPhone && <a className="ow-link ow-link--block" href={`tel:${appointment.customerPhone}`}>{appointment.customerPhone}</a>}</div>
      {actions.includes("done") && (pointsAmount
        ? <div className="ow-field"><label htmlFor="bd-amount">Betrag in Euro</label><input id="bd-amount" className="ow-input ow-num" inputMode="decimal" autoComplete="off" value={amount} onChange={event => setAmount(event.target.value)} aria-invalid={!amountMinor || undefined} aria-describedby="bd-amount-hint" /><span id="bd-amount-hint" className="ow-hint">Bei „Fertig“ werden Punkte für diesen Betrag gutgeschrieben.</span></div>
        : <p className="ow-hint">Bei „Fertig“ wird 1 {programType === "stamp" ? "Stempel" : "Punkt"} gutgeschrieben.</p>)}
      {actions.length > 0 && !actions.includes("done") && <p className="ow-hint">„Fertig“ geht ab {wallTime(new Date(Date.parse(appointment.start) - 10 * 60_000).toISOString(), zone)} Uhr.</p>}
      {error && <p className="ow-error" role="alert">{error}</p>}
      {actions.length > 0 && <div className="ow-stack" style={{ gap: "var(--space-2)" }}>
        {primary === "confirm" && actions.includes("done") && <button type="button" className="ow-btn ow-btn--secondary" onClick={() => void finish()} disabled={busy || (pointsAmount && !amountMinor)}>Fertig</button>}
        <button type="button" className="ow-btn ow-btn--secondary" onClick={() => { setError(""); setMode("move"); }} disabled={busy}>Verschieben</button>
        {actions.includes("no_show") && <button type="button" className="ow-btn ow-btn--secondary" onClick={() => void noShow()} disabled={busy}>Nicht erschienen</button>}
        <button type="button" className="ow-btn ow-btn--danger" onClick={() => { setError(""); setMode("cancel"); }} disabled={busy}>Absagen</button>
      </div>}
      <div className="ow-row" style={{ justifyContent: "space-between" }}>
        <span className="ow-hint">{appointment.noShowCount === 0 ? "Bisher immer erschienen." : `${appointment.noShowCount}× nicht erschienen, 12 Monate.`}{blocked && " Online-Buchung gesperrt."}</span>
        <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" onClick={() => void toggleBlock()} disabled={busy}>{blocked ? "Kunde entsperren" : "Kunde sperren"}</button>
      </div>
    </OwnerDialog>
  );
}

function BlockDialog({ day, onClose, onDone }: { day: DayResponse; onClose: () => void; onDone: (text: string, tone?: "ok" | "danger" | "info") => void }) {
  const [staffId, setStaffId] = useState("");
  const [from, setFrom] = useState("12:00");
  const [to, setTo] = useState("13:00");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ block: { id: string }; affected: OwnerAppointment[] } | null>(null);
  const start = wallToIso(day.date, from, day.timezone), end = to === "24:00" ? wallToIso(shiftDate(day.date, 1), "00:00", day.timezone) : wallToIso(day.date, to, day.timezone);
  const valid = Boolean(start && end && end > start);

  async function save() {
    setBusy(true); setError("");
    try {
      const result = await postJson<{ block: { id: string }; affected: OwnerAppointment[] }>("/api/merchant/booking/blocks", { staffId: staffId || undefined, start, end, reason: reason.trim() });
      if (result.affected.length) setCreated(result); else onDone(`${from}–${to} Uhr geblockt.`);
    } catch (cause) { setError(actionError(failure(cause))); }
    finally { setBusy(false); }
  }
  async function cancelAll() {
    if (!created) return;
    setBusy(true); setError("");
    try {
      const result = await postJson<{ cancelled: number }>(`/api/merchant/booking/blocks/${created.block.id}/cancel-affected`, {});
      onDone(result.cancelled === 1 ? "Zeit geblockt, 1 Termin abgesagt." : `Zeit geblockt, ${result.cancelled} Termine abgesagt.`);
    } catch (cause) { setError(actionError(failure(cause))); }
    finally { setBusy(false); }
  }

  if (created) return (
    <OwnerDialog title={created.affected.length === 1 ? "1 Termin liegt in der Zeit" : `${created.affected.length} Termine liegen in der Zeit`} tone="danger" onClose={() => onDone(`${from}–${to} Uhr geblockt. Termine bleiben.`)}
      actions={<><button type="button" className="ow-btn ow-btn--ghost" onClick={() => onDone(`${from}–${to} Uhr geblockt. Termine bleiben.`)} disabled={busy} data-autofocus>Termine behalten</button><button type="button" className="ow-btn ow-btn--danger" onClick={() => void cancelAll()} disabled={busy} aria-busy={busy}>Alle absagen</button></>}>
      <p>Die Zeit ist geblockt. Diese Kunden haben noch einen Termin:</p>
      <ul className="ow-feed">{created.affected.map(a => <li key={a.id}><span><strong className="ow-num">{wallTime(a.start, day.timezone)}</strong> · {a.service.name} · {a.customerName}</span></li>)}</ul>
      {error && <p className="ow-error" role="alert">{error}</p>}
    </OwnerDialog>
  );

  return (
    <OwnerDialog title="Zeit blocken" onClose={onClose} actions={<><button type="button" className="ow-btn ow-btn--ghost" onClick={onClose} disabled={busy}>Abbrechen</button><button type="button" className="ow-btn ow-btn--primary" onClick={() => void save()} disabled={busy || !valid} aria-busy={busy}>Zeit blocken</button></>}>
      <p>{longDate(day.date)}. In der Zeit kann niemand buchen.</p>
      <div className="ow-field"><label htmlFor="bd-who">Für wen</label><select id="bd-who" className="ow-select" value={staffId} onChange={event => setStaffId(event.target.value)} data-autofocus><option value="">Ganzer Laden</option>{day.staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
      <div className="ow-grid-2 ow-grid-2--end" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <div className="ow-field"><label htmlFor="bd-from">Von</label><input id="bd-from" type="time" step={900} className="ow-input" value={from} onChange={event => setFrom(event.target.value)} /></div>
        <div className="ow-field"><label htmlFor="bd-to">Bis</label><input id="bd-to" type="time" step={900} className="ow-input" value={to} onChange={event => setTo(event.target.value)} aria-invalid={!valid || undefined} /></div>
      </div>
      {!valid && <p className="ow-error">„Bis“ muss nach „Von“ liegen.</p>}
      <div className="ow-field"><label htmlFor="bd-why">Grund (optional)</label><input id="bd-why" className="ow-input" maxLength={80} value={reason} onChange={event => setReason(event.target.value)} placeholder="z. B. Arzttermin" /></div>
      {error && <p className="ow-error" role="alert">{error}</p>}
    </OwnerDialog>
  );
}

function ReleaseDialog({ block, onClose, onDone }: { block: DayBlock; onClose: () => void; onDone: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function release() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/merchant/booking/blocks/${block.id}`, { method: "DELETE", credentials: "same-origin" });
      if (!response.ok && response.status !== 404) throw new Error();
      onDone("Zeit wieder frei. Kunden können buchen.");
    } catch { setError("Das hat nicht geklappt. Versuch es noch einmal."); setBusy(false); }
  }
  return (
    <OwnerDialog title="Zeit freigeben?" onClose={onClose} actions={<><button type="button" className="ow-btn ow-btn--ghost" onClick={onClose} disabled={busy}>Abbrechen</button><button type="button" className="ow-btn ow-btn--primary" onClick={() => void release()} disabled={busy} aria-busy={busy} data-autofocus>Freigeben</button></>}>
      <p>{block.reason || "Geblockte Zeit"}. Danach können Kunden hier wieder buchen.</p>
      {error && <p className="ow-error" role="alert">{error}</p>}
    </OwnerDialog>
  );
}
