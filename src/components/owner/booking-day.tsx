"use client";

import { Ban, CalendarDays } from "lucide-react";
import { Row, Rows } from "./owner-rows";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiJson, ClientApiError, newRequestId, postJson } from "@/components/client-api";
import { EmptyState } from "@/components/ui/empty-state";
import { parsePurchaseAmountMinor } from "@/lib/points";
import { actionError, actionsFor, awardLine, dayName, dayRows, dayTotals, euroInput, longDate, patchDay, requestsLine, shiftDate, shortDate, STATUS_CHIP, statusWord, subLine, todayIn, wallTime, wallToIso, type DayBlock, type DayResponse, type OwnerAppointment } from "./booking-day-model";
import { missedPhrase } from "./booking-setup-helpers";
import { useOwner } from "./owner-context";
import { ErrorNotice, germanDate, LoadingBlock, Notice, OwnerDialog, OwnerIcon } from "./owner-ui";
import { useLoad } from "./use-load";

type Setup = { settings: { goalText: string; enabled: boolean; noShowBlockAfter: number } | null };
type Flash = { date: string; tone: "ok" | "danger" | "info"; text: string } | null;
type Blocked = { membershipId: string; name: string; cardLocator: string; blockedAt: string; reason: string };
type Done = (text: string, tone?: "ok" | "danger" | "info", row?: OwnerAppointment) => void;
const failure = (cause: unknown) => cause instanceof ClientApiError ? { code: cause.code, status: cause.status, message: cause.message } : {};
const BROWSER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function BookingDay() {
  const { me } = useOwner();
  const router = useRouter();
  const asked = useSearchParams().get("date");
  // No date until the owner picks one: the server answers with the shop's today, never the device's. The pick lives in the
  // URL (reload and the back button keep the day); the shop's zone is remembered so the header keeps it while the day loads.
  const urlDate = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : null;
  const [setup, reloadSetup] = useLoad<Setup>("/api/merchant/booking/setup");
  const [zone, setZone] = useState<string | null>(null);
  const [day, reload] = useLoad<DayResponse>(urlDate ? `/api/merchant/booking/day?date=${urlDate}` : "/api/merchant/booking/day");
  const [blocked, reloadBlocked] = useLoad<{ customers: Blocked[] }>("/api/merchant/booking/customers/blocked");
  // Rows changed here show at once, until the reload that follows every action arrives (a new `at`).
  const [patch, setPatch] = useState<{ at: number; rows: Record<string, OwnerAppointment> } | null>(null);
  const [open, setOpen] = useState<OwnerAppointment | null>(null);
  const [blockOpen, setBlockOpen] = useState<DayBlock | "new" | null>(null);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const shown = day.state === "ok" ? (patch?.at === day.at ? patchDay(day.data, patch.rows) : day.data) : null;
  const timezone = shown?.timezone ?? zone ?? BROWSER_ZONE;
  const today = todayIn(timezone);
  const date = urlDate ?? shown?.date ?? today;
  const pick = (target: string) => { setFlash(null); setZone(timezone); router.push(`/merchant/termine?date=${target}`, { scroll: false }); };
  const ready = setup.state === "ok" && setup.data.settings !== null;
  const blockedCount = blocked.state === "ok" ? blocked.data.customers.length : 0;

  const done: Done = (text, tone = "ok", row) => {
    setOpen(null); setBlockOpen(null); setBlockedOpen(false); setFlash({ date, tone, text });
    if (row && day.state === "ok") { const at = day.at; setPatch(current => ({ at, rows: { ...(current?.at === at ? current.rows : {}), [row.id]: row } })); }
    reload(); reloadBlocked();
  };

  return (
    <div className="ow-page" style={{ maxWidth: 720 }}>
      <header className="ow-pagehead">
        <div><h1>{dayName(date, today)}</h1><p>{subLine(date, today)}</p></div>
        {ready && <div className="ow-row"><button type="button" className="ow-btn ow-btn--secondary" disabled={!shown} onClick={() => { setFlash(null); setBlockOpen("new"); }}>Zeit blocken</button></div>}
      </header>
      {ready && setup.data.settings?.goalText && <p className="ow-muted">Dein Ziel: {setup.data.settings.goalText}</p>}
      {blockedCount > 0 && <div><button type="button" className="ow-link ow-link--block" style={{ background: "none", border: 0, padding: 0, font: "inherit", fontWeight: 700, cursor: "pointer" }} onClick={() => { setFlash(null); setBlockedOpen(true); }}>
        Gesperrt: {blockedCount === 1 ? "1 Kunde" : `${blockedCount} Kunden`}</button></div>}

      <nav className="ow-row" aria-label="Tag wählen" style={{ flexWrap: "nowrap", gap: "var(--space-1)" }}>
        <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" aria-label="Vorheriger Tag" onClick={() => pick(shiftDate(date, -1))}>←</button>
        <div className="ow-seg" role="group" aria-label="Schnellwahl" style={{ flex: "1 1 auto", maxWidth: 360, justifyContent: "space-between" }}>
          {[-1, 0, 1].map(offset => { const target = shiftDate(today, offset); return <button key={offset} type="button" style={{ flex: 1 }} aria-pressed={date === target} onClick={() => pick(target)}>{dayName(target, today)}</button>; })}
        </div>
        <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" aria-label="Nächster Tag" onClick={() => pick(shiftDate(date, 1))}>→</button>
      </nav>

      {setup.state === "ok" && !setup.data.settings && (
        <Notice tone="info" actions={<Link className="ow-btn ow-btn--sm ow-btn--primary" href="/merchant/termine/einrichten">Jetzt einrichten</Link>}>Richte zuerst Leistungen und Zeiten ein.</Notice>
      )}
      {setup.state === "ok" && setup.data.settings && !setup.data.settings.enabled && (
        <Notice tone="warn" actions={<Link className="ow-btn ow-btn--sm ow-btn--secondary" href="/merchant/termine/einrichten">Zur Einrichtung</Link>}>Online-Buchung ist aus. Kunden können gerade nicht buchen.</Notice>
      )}
      {ready && shown && <p className="ow-num" style={{ fontWeight: 700, margin: 0 }} aria-live="polite">{dayTotals(shown.appointments)}</p>}
      {flash?.date === date && <Notice tone={flash.tone} role={flash.tone === "danger" ? "alert" : "status"}>{flash.text}</Notice>}
      {shown && shown.pendingRequests > 0 && <Notice tone="warn" actions={shown.nextRequestDate && shown.nextRequestDate !== date
        ? <button type="button" className="ow-btn ow-btn--sm ow-btn--secondary" onClick={() => pick(shown.nextRequestDate!)}>Anfrage zeigen</button> : undefined}>
        {requestsLine(shown.pendingRequests, shown.nextRequestDate, today)}</Notice>}

      {day.state === "error" ? <ErrorNotice message={day.status === 403 ? "Nur Inhaber und Leitung sehen die Termine." : "Die Termine konnten nicht geladen werden."} onRetry={reload} />
        : setup.state === "error" ? <ErrorNotice message="Die Einrichtung konnte nicht geladen werden." onRetry={reloadSetup} />
        : !shown || setup.state !== "ok" ? <LoadingBlock rows={3} height={56} />
        : ready && <DayList day={shown} label={dayName(date, today)} onOpen={appointment => { setFlash(null); setOpen(appointment); }} onBlock={block => { setFlash(null); setBlockOpen(block); }} />}

      {open && shown && <AppointmentSheet appointment={open} day={shown} programType={me?.programType ?? "stamp"} purchase={me?.earningMode === "purchase"} noShowBlockAfter={setup.state === "ok" ? setup.data.settings?.noShowBlockAfter ?? 0 : 0} onClose={() => setOpen(null)} onDone={done}
        onAward={(text, row) => { done(text, "ok", row); window.setTimeout(() => setFlash(current => current?.text === text ? null : current), 2000); }} />}
      {blockOpen && shown && (blockOpen === "new"
        ? <BlockDialog day={shown} onClose={() => setBlockOpen(null)} onDone={done} />
        : <ReleaseDialog block={blockOpen} onClose={() => setBlockOpen(null)} onDone={done} />)}
      {blockedOpen && blocked.state === "ok" && <BlockedDialog customers={blocked.data.customers} onClose={() => setBlockedOpen(false)} onDone={done} />}
    </div>
  );
}

function DayList({ day, label, onOpen, onBlock }: { day: DayResponse; label: string; onOpen: (appointment: OwnerAppointment) => void; onBlock: (block: DayBlock) => void }) {
  const rows = dayRows(day);
  const staffName = (id: string | null) => id ? day.staff.find(s => s.id === id)?.name ?? "Mitarbeiter" : "Ganzer Laden";
  if (!rows.length) return <section className="ow-card"><EmptyState level={2} icon={<OwnerIcon name="calendar" size={24} />} title={`${label} keine Termine.`}>Kunden buchen über ihre Karte.</EmptyState></section>;
  return (
    <div className="ow-prog"><Rows title="Termine des Tages">{rows.map(row => row.kind === "block"
      ? <Row key={row.block.id} icon={Ban} title={`${wallTime(row.block.start, day.timezone)}–${wallTime(row.block.end, day.timezone)} · Geblockt`} sub={[row.block.reason, staffName(row.block.staffId)].filter(Boolean).join(" · ") || undefined} onClick={() => onBlock(row.block)} />
      : <Row key={row.appointment.id} icon={CalendarDays} title={`${wallTime(row.appointment.start, day.timezone)} · ${row.appointment.service.name}`}
          sub={<>{row.appointment.customerName} · {row.appointment.staff.name}{row.inBlock && <><br />liegt in geblockter Zeit</>}</>}
          chip={{ label: statusWord(row.appointment), warn: row.appointment.status === "requested" || row.appointment.status === "no_show" || row.inBlock }} onClick={() => onOpen(row.appointment)} />)}
    </Rows></div>
  );
}

type Mode = "main" | "cancel" | "move" | "no_show" | "block";
type Slot = { start: string; staffId: string };

function AppointmentSheet({ appointment, day, programType, purchase, noShowBlockAfter, onClose, onDone, onAward }: { appointment: OwnerAppointment; day: DayResponse; programType: "stamp" | "points"; purchase: boolean; noShowBlockAfter: number; onClose: () => void; onDone: Done; onAward: (text: string, row: OwnerAppointment) => void }) {
  const [mode, setMode] = useState<Mode>("main");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState(euroInput(appointment.priceMinor));
  const [reason, setReason] = useState("");
  const [moveDate, setMoveDate] = useState(day.date);
  const [moveStaff, setMoveStaff] = useState(appointment.staff.id);
  const [slots, setSlots] = useState<{ staff: Array<{ id: string; name: string }>; slots: Slot[] } | null>(null);
  const [slotError, setSlotError] = useState(false);
  const [picked, setPicked] = useState<Slot | null>(null);
  const actions = actionsFor(appointment.status, appointment.start);
  const blocked = day.blockedMembershipIds.includes(appointment.membershipId);
  const zone = day.timezone, time = wallTime(appointment.start, zone);
  const pointsAmount = programType === "points" && purchase;
  // Empty or 0 € completes without a credit (a free service); only unreadable text blocks „Fertig“.
  const noAmount = /^(?:0+(?:[,.]0{1,2})?)?$/.test(amount.trim());
  let amountMinor: number | null = null;
  try { amountMinor = pointsAmount && !noAmount ? parsePurchaseAmountMinor(amount) : null; } catch { amountMinor = null; }
  const amountInvalid = pointsAmount && !noAmount && amountMinor === null;
  // The booked slot itself is no move: the server would change nothing.
  const free = slots?.slots.filter(slot => slot.staffId === moveStaff && !(slot.start === appointment.start && slot.staffId === appointment.staff.id)) ?? null;
  const staffName = (id: string) => slots?.staff.find(s => s.id === id)?.name ?? day.staff.find(s => s.id === id)?.name ?? "";

  useEffect(() => {
    if (mode !== "move") return;
    let live = true;
    void apiJson<{ staff: Array<{ id: string; name: string }>; slots: Slot[] }>(`/api/merchant/booking/appointments/${appointment.id}/slots?date=${moveDate}`)
      .then(result => { if (live) { setSlots(result); setSlotError(false); } }).catch(() => { if (live) setSlotError(true); });
    return () => { live = false; setSlots(null); setPicked(null); };
  }, [mode, moveDate, appointment.id]);

  async function run(call: () => Promise<unknown>, success: (result: never) => void) {
    setBusy(true); setError("");
    try { success(await call() as never); }
    catch (cause) {
      const info = failure(cause);
      if (info.code === "STALE" || info.code === "STALE_RULE" || info.code === "NOT_FOUND") { onDone(actionError(info), "info"); return; }
      if (info.code === "SLOT_TAKEN") setPicked(null);
      setError(actionError(info, appointment, zone));
    } finally { setBusy(false); }
  }
  const transition = (to: "confirmed" | "done" | "no_show" | "cancelled_by_shop", extra: object = {}) =>
    postJson<OwnerAppointment>(`/api/merchant/booking/appointments/${appointment.id}/transition`, { to, expected: appointment.status, idempotencyKey: newRequestId(), ...extra });

  const confirm = () => run(() => transition("confirmed"), (row: OwnerAppointment) => onDone(`Termin ${time} bestätigt.`, "ok", row));
  const finish = () => run(() => transition("done", pointsAmount && amountMinor ? { purchaseAmountMinor: amountMinor } : {}),
    (row: OwnerAppointment) => onAward(row.doneAward ? awardLine(programType, row.doneAward.creditedQuantity) : "Termin erledigt.", row));
  const noShow = () => run(() => transition("no_show"), (row: OwnerAppointment) => onDone(`${appointment.customerName}: nicht erschienen.`, "ok", row));
  const cancel = () => run(() => transition("cancelled_by_shop", reason.trim() ? { reason: reason.trim() } : {}), (row: OwnerAppointment) => onDone(`Termin ${time} abgesagt.`, "ok", row));
  const moveName = dayName(moveDate, todayIn(zone));
  const moveDayName = /^(Heute|Morgen)$/.test(moveName) ? moveName.toLowerCase() : `${moveName}, ${shortDate(moveDate)}`;
  const move = () => picked && run(() => postJson<OwnerAppointment>(`/api/merchant/booking/appointments/${appointment.id}/move`, picked),
    (row: OwnerAppointment) => onDone(`Termin verschoben auf ${moveDayName}, ${wallTime(picked.start, zone)} Uhr${picked.staffId !== appointment.staff.id ? ` bei ${staffName(picked.staffId)}` : ""}.`, "ok", row));
  const toggleBlock = () => run(() => postJson(`/api/merchant/booking/customers/${appointment.membershipId}/${blocked ? "unblock" : "block"}`, {}).catch(cause => {
    // The routes answer 204 without a body, which apiJson reads as an empty answer.
    if (cause instanceof ClientApiError && cause.status === 204) return; throw cause;
  }), () => onDone(blocked ? `${appointment.customerName} kann wieder online buchen.` : `${appointment.customerName} kann nicht mehr online buchen.`));

  const close = <button type="button" className="ow-btn ow-btn--ghost" onClick={mode === "main" ? onClose : () => { setMode("main"); setError(""); }} disabled={busy}>{mode === "main" ? "Schließen" : "Zurück"}</button>;
  const title = `${time} · ${appointment.service.name}`;

  if (mode === "cancel") return (
    <OwnerDialog key="cancel" title="Termin absagen?" tone="danger" onClose={onClose} actions={<>{close}<button type="button" className="ow-btn ow-btn--danger" onClick={() => void cancel()} disabled={busy} aria-busy={busy}>Absagen</button></>}>
      <p>{title} · {appointment.customerName}. Der Kunde bekommt eine Mitteilung, wenn er Erinnerungen an hat; sonst sieht er es auf seiner Karte.</p>
      <div className="ow-field"><label htmlFor="bd-reason">Grund (optional)</label><input id="bd-reason" className="ow-input" maxLength={80} value={reason} onChange={event => setReason(event.target.value)} placeholder="z. B. Krankheit" data-autofocus /></div>
      {error && <p className="ow-error" role="alert">{error}</p>}
    </OwnerDialog>
  );

  if (mode === "no_show") return (
    <OwnerDialog key="no_show" title="Nicht erschienen?" tone="danger" onClose={onClose} actions={<>{close}<button type="button" className="ow-btn ow-btn--danger" onClick={() => void noShow()} disabled={busy} aria-busy={busy}>Nicht erschienen</button></>}>
      <p>{title} · {appointment.customerName}. Zählt als verpasster Termin.{noShowBlockAfter > 0 && ` Nach ${missedPhrase(noShowBlockAfter)} in 12 Monaten kann der Kunde nicht mehr online buchen.`}</p>
      {error && <p className="ow-error" role="alert">{error}</p>}
    </OwnerDialog>
  );

  if (mode === "block") return (
    <OwnerDialog key="block" title="Kunde sperren?" tone="danger" onClose={onClose} actions={<>{close}<button type="button" className="ow-btn ow-btn--danger" onClick={() => void toggleBlock()} disabled={busy} aria-busy={busy}>Sperren</button></>}>
      <p>{appointment.customerName} kann danach nicht mehr online buchen, nur noch anrufen. Gebuchte Termine bleiben. Du hebst das unter „Gesperrt“ mit einem Tipp auf.</p>
      {error && <p className="ow-error" role="alert">{error}</p>}
    </OwnerDialog>
  );

  if (mode === "move") return (
    <OwnerDialog key="move" title="Termin verschieben" onClose={onClose} actions={<>{close}<button type="button" className="ow-btn ow-btn--primary" onClick={() => void move()} disabled={busy || !picked} aria-busy={busy}>{picked ? `Auf ${wallTime(picked.start, zone)} Uhr verschieben` : "Verschieben"}</button></>}>
      <p>{title} · bei {appointment.staff.name}</p>
      <div className="ow-field"><label htmlFor="bd-move-date">Tag</label><input id="bd-move-date" type="date" className="ow-input" value={moveDate} min={todayIn(zone)} onChange={event => { if (event.target.value) setMoveDate(event.target.value); }} /></div>
      {slots && slots.staff.length > 1 && <div className="ow-field"><span className="ow-label" id="bd-staff">Bei</span>
        <div className="ow-seg" role="group" aria-labelledby="bd-staff">{slots.staff.map(member => <button key={member.id} type="button" aria-pressed={moveStaff === member.id} onClick={() => { setMoveStaff(member.id); setPicked(null); }}>{member.name}</button>)}</div></div>}
      <span className="ow-label" id="bd-slots">Freie Zeiten</span>
      {slotError ? <p className="ow-error" role="alert">Freie Zeiten nicht geladen. Wähle den Tag neu.</p>
        : free === null ? <LoadingBlock rows={1} height={44} />
        : free.length === 0 ? <p className="ow-muted">{slots && slots.staff.length > 1 ? `Bei ${staffName(moveStaff)} ist an diesem Tag nichts frei.` : "An diesem Tag ist nichts frei."}</p>
        : <div className="ow-row" role="group" aria-labelledby="bd-slots" style={{ gap: "var(--space-2)" }}>{free.map(slot => <button key={slot.start} type="button" className="ow-btn ow-btn--secondary ow-btn--sm ow-num" aria-pressed={picked?.start === slot.start} style={picked?.start === slot.start ? { borderColor: "var(--color-action)", background: "var(--color-action-soft)" } : undefined} onClick={() => setPicked(slot)}>{wallTime(slot.start, zone)}</button>)}</div>}
      {error && <p className="ow-error" role="alert">{error}</p>}
    </OwnerDialog>
  );

  const primary = actions.includes("confirm") ? "confirm" : actions.includes("done") ? "done" : null;
  return (
    <OwnerDialog key="main" title={title} onClose={onClose} actions={<>{close}
      {primary === "confirm" && <button type="button" className="ow-btn ow-btn--primary" onClick={() => void confirm()} disabled={busy} aria-busy={busy} data-autofocus>Bestätigen</button>}
      {primary === "done" && <button type="button" className="ow-btn ow-btn--primary" onClick={() => void finish()} disabled={busy || amountInvalid} aria-busy={busy} data-autofocus>Fertig</button>}
    </>}>
      <p>{appointment.customerName} · <span translate="no">{appointment.cardLocator}</span> · bei {appointment.staff.name}</p>
      <div className="ow-row"><span className={STATUS_CHIP[appointment.status]}>{statusWord(appointment)}</span>{appointment.customerPhone && <a className="ow-link ow-link--block" href={`tel:${appointment.customerPhone}`}>{appointment.customerPhone}</a>}</div>
      {actions.includes("done") && (pointsAmount
        ? <div className="ow-field"><label htmlFor="bd-amount">Betrag in Euro</label><input id="bd-amount" className="ow-input ow-num" inputMode="decimal" autoComplete="off" value={amount} onChange={event => setAmount(event.target.value)} aria-invalid={amountInvalid || undefined} aria-describedby="bd-amount-hint" /><span id="bd-amount-hint" className="ow-hint">Bei „Fertig“ werden Punkte für diesen Betrag gutgeschrieben. Ohne Betrag gibt es keine Punkte.</span></div>
        : <p className="ow-hint">Bei „Fertig“ wird 1 {programType === "stamp" ? "Stempel" : "Punkt"} gutgeschrieben.</p>)}
      {appointment.status === "confirmed" && !actions.includes("done") && <p className="ow-hint">„Fertig“ geht ab {wallTime(new Date(Date.parse(appointment.start) - 10 * 60_000).toISOString(), zone)} Uhr.</p>}
      {error && <p className="ow-error" role="alert">{error}</p>}
      {actions.length > 0 && <div className="ow-stack" style={{ gap: "var(--space-2)" }}>
        {primary === "confirm" && actions.includes("done") && <button type="button" className="ow-btn ow-btn--secondary" onClick={() => void finish()} disabled={busy || amountInvalid}>Fertig</button>}
        <button type="button" className="ow-btn ow-btn--secondary" onClick={() => { setError(""); setMode("move"); }} disabled={busy}>Verschieben</button>
        {actions.includes("no_show") && <button type="button" className="ow-btn ow-btn--secondary" onClick={() => { setError(""); setMode("no_show"); }} disabled={busy}>Nicht erschienen</button>}
        <button type="button" className="ow-btn ow-btn--danger" onClick={() => { setError(""); setMode("cancel"); }} disabled={busy}>Absagen</button>
      </div>}
      <div className="ow-row" style={{ justifyContent: "space-between" }}>
        <span className="ow-hint">{appointment.noShowCount === 0 ? "Bisher immer erschienen." : `${appointment.noShowCount}× nicht erschienen, 12 Monate.`}{blocked && " Online-Buchung gesperrt."}</span>
        <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" onClick={() => { setError(""); if (blocked) void toggleBlock(); else setMode("block"); }} disabled={busy}>{blocked ? "Kunde entsperren" : "Kunde sperren"}</button>
      </div>
    </OwnerDialog>
  );
}

/** "HH:MM" now in the shop's zone, rounded up to the next quarter hour (at most 23:45). */
function nextQuarter(zone: string) {
  const [h, m] = wallTime(new Date().toISOString(), zone).split(":").map(Number);
  const minutes = Math.min(Math.ceil((h * 60 + m) / 15) * 15, 23 * 60 + 45);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function BlockDialog({ day, onClose, onDone }: { day: DayResponse; onClose: () => void; onDone: Done }) {
  const [staffId, setStaffId] = useState("");
  const [from, setFrom] = useState("12:00");
  const [to, setTo] = useState("13:00");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ block: { id: string }; affected: OwnerAppointment[] } | null>(null);
  // „Bis 00:00“ is the end of the day (the time field cannot show 24:00).
  const endOfDay = to === "00:00" || to === "24:00";
  const start = wallToIso(day.date, from, day.timezone), end = endOfDay ? wallToIso(shiftDate(day.date, 1), "00:00", day.timezone) : wallToIso(day.date, to, day.timezone);
  const valid = Boolean(start && end && end > start);
  const span = `${from}–${endOfDay ? "24:00" : to} Uhr`;

  async function save() {
    setBusy(true); setError("");
    try {
      const result = await postJson<{ block: { id: string }; affected: OwnerAppointment[] }>("/api/merchant/booking/blocks", { staffId: staffId || undefined, start, end, reason: reason.trim() });
      if (result.affected.length) setCreated(result); else onDone(`${span} geblockt.`);
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
    <OwnerDialog title={created.affected.length === 1 ? "1 Termin liegt in der Zeit" : `${created.affected.length} Termine liegen in der Zeit`} tone="danger" onClose={() => onDone(`${span} geblockt. Termine bleiben.`)}
      actions={<><button type="button" className="ow-btn ow-btn--ghost" onClick={() => onDone(`${span} geblockt. Termine bleiben.`)} disabled={busy} data-autofocus>Termine behalten</button><button type="button" className="ow-btn ow-btn--danger" onClick={() => void cancelAll()} disabled={busy} aria-busy={busy}>Alle absagen</button></>}>
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
        <div className="ow-field"><label htmlFor="bd-to">Bis</label><input id="bd-to" type="time" step={900} className="ow-input" value={endOfDay ? "00:00" : to} onChange={event => setTo(event.target.value)} aria-invalid={!valid || undefined} aria-describedby={endOfDay ? "bd-to-hint" : undefined} />{endOfDay && <span id="bd-to-hint" className="ow-hint">Tagesende</span>}</div>
      </div>
      <div className="ow-row" style={{ gap: "var(--space-2)" }}>
        <button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={() => { if (day.date === todayIn(day.timezone)) setFrom(nextQuarter(day.timezone)); setTo("00:00"); }}>Rest des Tages</button>
        <button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={() => { setFrom("00:00"); setTo("00:00"); }}>Ganzer Tag</button>
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

function BlockedDialog({ customers, onClose, onDone }: { customers: Blocked[]; onClose: () => void; onDone: Done }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function unblock(customer: Blocked) {
    setBusy(customer.membershipId); setError("");
    try {
      await postJson(`/api/merchant/booking/customers/${customer.membershipId}/unblock`, {}).catch(cause => {
        // The route answers 204 without a body, which apiJson reads as an empty answer.
        if (cause instanceof ClientApiError && cause.status === 204) return; throw cause;
      });
      onDone(`${customer.name} kann wieder online buchen.`);
    } catch (cause) { setError(actionError(failure(cause))); setBusy(""); }
  }
  return (
    <OwnerDialog title="Gesperrte Kunden" onClose={onClose} actions={<button type="button" className="ow-btn ow-btn--ghost" onClick={onClose} disabled={Boolean(busy)}>Schließen</button>}>
      <p>Sie können nicht online buchen, nur anrufen.</p>
      {customers.length === 0 ? <p className="ow-muted">Niemand ist gesperrt.</p> : <ul className="ow-feed">{customers.map(customer => (
        <li key={customer.membershipId}>
          <span><strong>{customer.name}</strong> · <span translate="no">{customer.cardLocator}</span><small className="ow-muted" style={{ display: "block" }}>seit {germanDate(customer.blockedAt)}{customer.reason && ` · ${customer.reason}`}</small></span>
          <button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={() => void unblock(customer)} disabled={Boolean(busy)} aria-busy={busy === customer.membershipId}>Entsperren</button>
        </li>))}</ul>}
      {error && <p className="ow-error" role="alert">{error}</p>}
    </OwnerDialog>
  );
}
