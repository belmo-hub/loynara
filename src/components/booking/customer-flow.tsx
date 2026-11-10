"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiJson } from "../client-api";
import { Badge } from "../ui/badge";
import { Button, buttonClassName } from "../ui/button";
import { CustomerShell } from "../ui/customer-shell";
import { TextField } from "../ui/field";
import { Skeleton } from "../ui/skeleton";
import { CustomerState } from "../customer/customer-state";
import card from "../customer/customer-card.module.css";
import notice from "../customer/customer-notice.module.css";
import legal from "../customer/customer-state.module.css";
import { LegalLinks } from "../ui/legal-links";
import styles from "./customer-flow.module.css";
import { defaultTerms, durationLabel, missedPhrase } from "../owner/booking-setup-helpers";
import { addDays } from "@/lib/booking/time";
import { BookingPush } from "./booking-push";
import { attemptKey, daysWithSlots, formatDay, formatPrice, formatTime, formatWhen, wallDate, type Appointment, type BookingView, type Service, type Slot, type SlotDay } from "./booking-format";

type Step = "service" | "day" | "time" | "confirm" | "done";
type Enabled = Extract<BookingView, { enabled: true }>;
type Problem = { text: string; nextFree?: string; retry?: boolean; pick?: boolean };
type Failure = { status: number; code?: string; nextFree?: string };

const CONTACT = "loynara_booking_contact";
const PAUSED = "Online-Buchung in diesem Geschäft ist pausiert. Ruf kurz an.";
const PAST: Record<string, string> = { done: "erledigt", no_show: "nicht erschienen", cancelled_by_customer: "abgesagt", cancelled_by_shop: "vom Geschäft abgesagt", requested: "vorbei", confirmed: "vorbei" };
// The slots route serves at most 14 days per request; "Weitere Tage" asks for the next 14.
const WINDOW = 14;
const COUNT = ["keine", "einen offenen Termin", "zwei offene Termine", "drei offene Termine"];

// apiJson drops the body's extra fields, and SLOT_TAKEN needs nextFree.
async function post<T>(url: string, body: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch { throw { status: 0 } satisfies Failure; }
  const data = await response.json().catch(() => null) as (T & { code?: string; nextFree?: string }) | null;
  if (!response.ok || !data) throw { status: response.status, code: data?.code, nextFree: data?.nextFree } satisfies Failure;
  return data;
}

function problemFor(cause: unknown, view: Enabled): Problem {
  const { status, code, nextFree } = (cause ?? {}) as Failure;
  if (status === 0) return { text: "Keine Verbindung. Versuch es gleich noch mal.", retry: true };
  if (code === "SLOT_TAKEN") return nextFree ? { text: `Der Termin ist gerade weg. Nächster freier: ${formatTime(nextFree, view.shop.timezone)}`, nextFree } : { text: "Der Termin ist gerade weg. Such dir eine andere Zeit aus.", pick: true };
  if (code === "BLOCKED" || code === "OUT_OF_WINDOW") return { text: "Diese Zeit geht nicht mehr. Such dir eine andere aus.", pick: true };
  if (code === "BLOCKED_CUSTOMER") return { text: PAUSED };
  if (code === "TOO_MANY_OPEN") return { text: `Mehr als ${COUNT[view.shop.maxOpenPerCard] ?? `${view.shop.maxOpenPerCard} offene Termine`} gleichzeitig geht hier nicht. Sag einen ab, dann geht ein neuer.` };
  if (code === "RESCHEDULE_LIMIT") return { text: `Diesen Monat hast du schon ${view.shop.maxReschedulesPerMonth}-mal verschoben. Sag ab und buch neu.` };
  if (code === "TOO_LATE") return { text: "Dafür ist es jetzt zu spät. Ruf kurz im Geschäft an." };
  if (code === "OWN_OVERLAP") return { text: "Du hast zu dieser Zeit schon einen Termin. Such dir eine andere Zeit aus.", pick: true };
  if (code === "STALE") return { text: "Der Termin hat sich inzwischen geändert. Schau oben nach." };
  if (code === "RATE_LIMIT") return { text: "Zu viele Versuche. Warte kurz und versuch es dann noch mal.", retry: true };
  if (code === "NOT_FOUND") return { text: "Online-Buchung geht hier gerade nicht. Ruf kurz im Geschäft an." };
  return { text: "Das hat nicht geklappt. Versuch es noch mal.", retry: true };
}

const passed = (instant: number) => Date.now() >= instant;

function rebookArrival(view: Enabled) {
  const query = new URLSearchParams(window.location.search);
  const service = view.blocked ? undefined : view.services.find(s => s.id === query.get("service"));
  if (!service) return null;
  const staffId = view.staff.find(s => s.id === query.get("staff") && (!s.serviceIds.length || s.serviceIds.includes(service.id)))?.id ?? "";
  const rebook = query.get("rebook") ?? "";
  return { service, staffId, rebook: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rebook) ? rebook : undefined };
}

// Per card, so a shared phone does not prefill one card's booking with the last person's name.
const contactKey = (token: string) => `${CONTACT}:${token}`;

function readContact(token: string): { name: string; phone: string } {
  // The old key held the last person's details for every card on this phone.
  try { localStorage.removeItem(CONTACT); } catch {}
  try { return { name: "", phone: "", ...JSON.parse(localStorage.getItem(contactKey(token)) ?? "{}") }; } catch { return { name: "", phone: "" }; }
}

/** The customer's booking page: „Meine Termine“ first, then service → day → time → confirm, all in one component. */
export function CustomerFlow({ token }: { token: string }) {
  const base = `/api/card/${encodeURIComponent(token)}/booking`;
  const [view, setView] = useState<BookingView | null>(null);
  const [loadError, setLoadError] = useState("");
  const load = useCallback(() => apiJson<BookingView>(base).then(result => { setView(result); setLoadError(""); }, () => setLoadError("Lad die Seite gleich noch mal. Wenn es nicht geht, ruf kurz im Geschäft an.")), [base]);
  useEffect(() => { void load(); }, [load]);

  if (loadError && !view) return <CustomerState title="Termine nicht erreichbar." message={loadError} tone="error"><Button onClick={() => void load()}>Noch mal laden</Button></CustomerState>;
  if (!view) return <CustomerShell footer={<LegalLinks newTab />}><div className={legal.loading} aria-busy="true" aria-label="Termine werden geladen.">
    <Skeleton height={48} width="60%" radius={14} /><Skeleton height={140} radius={20} /><Skeleton height={280} radius={20} />
  </div></CustomerShell>;
  if (!view.enabled) return <CustomerState title="Hier gibt es keine Online-Termine." message="Frag im Geschäft nach einem Termin."><Link href={`/card/${encodeURIComponent(token)}`} className={buttonClassName({ variant: "secondary" })}>Zur Karte</Link></CustomerState>;
  return <Flow token={token} base={base} view={view} reload={load} />;
}

function Flow({ token, base, view, reload }: { token: string; base: string; view: Enabled; reload: () => Promise<void> }) {
  const tz = view.shop.timezone;
  // Flow mounts only after the client read, so the URL and localStorage are there on first render.
  const [arrival] = useState(() => rebookArrival(view));
  const [step, setStep] = useState<Step>(arrival ? "day" : "service");
  const [moving, setMoving] = useState<Appointment | null>(null);
  const [service, setService] = useState<Service | null>(arrival?.service ?? null);
  const [staffId, setStaffId] = useState(arrival?.staffId ?? "");
  const [days, setDays] = useState<SlotDay[] | null>(null);
  const [slotsError, setSlotsError] = useState("");
  const [allDays, setAllDays] = useState(false);
  // The loaded window: first day, length in days, and whether the last "Weitere Tage" came back empty.
  const [range, setRange] = useState<{ from: string; span: number; end: boolean } | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [day, setDay] = useState<SlotDay | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [contact, setContact] = useState(() => readContact(token));
  const [showPhone, setShowPhone] = useState(() => Boolean(contact.phone));
  const [nameError, setNameError] = useState("");
  const [key, setKey] = useState("");
  const [deadlinePassed, setDeadlinePassed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [result, setResult] = useState<Appointment | null>(null);
  // The rebook link counts for the first booking of this visit only.
  const [rebookSourceId, setRebookSourceId] = useState(arrival?.rebook);
  // One service-worker scope per card, so each card keeps its own push subscription on a shared phone.
  const swScope = `/card/${encodeURIComponent(token)}/`;
  // The enforced rules always show; the shop's own text shows on top of them unless it is the generated default (then it would repeat them).
  const ownTerms = Boolean(view.shop.termsText) && view.shop.termsText !== defaultTerms(view.shop);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const slotsRequest = useRef(0);

  // The rebook push links here with ?service=&staff=&rebook=: the day step opens with both pre-selected.
  useEffect(() => { if (arrival) void loadSlots(arrival.service, arrival.staffId); }, [arrival]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each step change moves focus to its heading, so a screen reader announces the new step and the page scrolls to it.
  useEffect(() => { if (moved.current) heading.current?.focus(); }, [step, moving]);

  function go(next: Step) { moved.current = true; setProblem(null); setStep(next); }

  async function fetchDays(target: Service, staff: string, from: string, moveId?: string) {
    const query = new URLSearchParams({ serviceId: target.id, from, days: String(WINDOW) });
    if (staff) query.set("staffId", staff);
    if (moveId) query.set("appointmentId", moveId);
    return daysWithSlots((await apiJson<{ days: SlotDay[] }>(`${base}/slots?${query}`)).days);
  }

  async function loadSlots(target: Service, staff: string, moveId?: string) {
    // Only the newest request may land: a slower answer for an earlier choice is dropped.
    const requestId = ++slotsRequest.current;
    setDays(null); setSlotsError(""); setAllDays(false); setMoreBusy(false);
    const from = wallDate(new Date(), tz);
    try { const found = await fetchDays(target, staff, from, moveId); if (requestId === slotsRequest.current) { setDays(found); setRange({ from, span: WINDOW, end: WINDOW > view.shop.maxDaysAhead }); } }
    catch { if (requestId === slotsRequest.current) setSlotsError("Die freien Zeiten konnten nicht geladen werden."); }
  }

  async function loadMore() {
    if (!service || !days || !range) return;
    const requestId = ++slotsRequest.current;
    setMoreBusy(true);
    try {
      const found = await fetchDays(service, staffId, addDays(range.from, range.span), moving?.id);
      if (requestId === slotsRequest.current) { setDays([...days, ...found]); setAllDays(true); setRange({ ...range, span: range.span + WINDOW, end: !found.length || range.span + WINDOW > view.shop.maxDaysAhead }); }
    } catch { if (requestId === slotsRequest.current) setSlotsError("Die freien Zeiten konnten nicht geladen werden."); }
    finally { if (requestId === slotsRequest.current) setMoreBusy(false); }
  }

  function chooseService(target: Service) { if (target.id !== arrival?.service.id) setRebookSourceId(undefined); setService(target); setStaffId(""); void loadSlots(target, ""); go("day"); }
  function chooseStaff(id: string) { setStaffId(id); if (service) void loadSlots(service, id, moving?.id); }
  function chooseSlot(target: Slot) { setSlot(target); setKey(attemptKey()); setDeadlinePassed(passed(Date.parse(target.start) - view.shop.cancelDeadlineHours * 3_600_000)); go("confirm"); }

  function startMove(appointment: Appointment) {
    const target = view.services.find(s => s.id === appointment.service.id) ?? { ...appointment.service, durationMin: appointment.durationMin, priceMinor: appointment.priceMinor, priceFrom: false };
    // Moves keep the booked staff member unless the customer picks another; the appointment's own time stays free.
    setMoving(appointment); setResult(null); setService(target); setStaffId(appointment.staff.id); void loadSlots(target, appointment.staff.id, appointment.id); go("day");
  }

  function reset() { moved.current = true; setMoving(null); setService(null); setSlot(null); setDay(null); setResult(null); setProblem(null); setStep("service"); }

  function back() {
    if (step === "confirm") go("time");
    else if (step === "time") go("day");
    else reset();
  }

  async function submit(start: string, attempt: string) {
    if (!service) return;
    if (!moving && !contact.name.trim()) { setNameError("Trag deinen Namen ein."); document.getElementById("booking-name")?.focus(); return; }
    setBusy(true); setProblem(null); setNameError("");
    try {
      const appointment = moving
        ? await post<Appointment>(`${base}/appointments/${moving.id}/reschedule`, { start, staffId: staffId || undefined })
        : await post<Appointment>(`${base}/appointments`, { serviceId: service.id, staffId: staffId || undefined, start, customerName: contact.name.trim(), customerPhone: contact.phone.trim() || undefined, idempotencyKey: attempt, rebookSourceId });
      if (!moving) { try { localStorage.setItem(contactKey(token), JSON.stringify({ name: contact.name.trim(), phone: contact.phone.trim() })); } catch { /* prefill is a convenience */ } }
      setResult(appointment); setRebookSourceId(undefined); go("done"); void reload();
    } catch (cause) {
      setProblem(problemFor(cause, view));
      if ((cause as Failure).code === "STALE") void reload();
    } finally { setBusy(false); }
  }

  function takeNextFree(start: string) { const next = attemptKey(); setSlot({ start, staffId: slot?.staffId ?? "" }); setKey(next); void submit(start, next); }
  function pickAgain() { if (service) void loadSlots(service, staffId, moving?.id); go("day"); }

  const staffForService = service ? view.staff.filter(s => !s.serviceIds.length || s.serviceIds.includes(service.id)) : [];
  // A move keeps the booked staff member even when no longer linked to the service; then "Egal wer" must be on offer.
  const showStaff = staffForService.length > 1 || Boolean(staffId && !staffForService.some(s => s.id === staffId));
  const moreDays = range && !range.end ? <Button variant="quiet" size="sm" loading={moreBusy} onClick={() => void loadMore()}>Weitere Tage</Button> : null;
  const staffName = (id: string) => view.staff.find(s => s.id === id)?.name;
  const total = moving ? 3 : 4;
  const index = { service: 1, day: moving ? 1 : 2, time: moving ? 2 : 3, confirm: moving ? 3 : 4, done: total }[step];
  const shown = days ? (allDays ? days : days.slice(0, 7)) : [];
  const header = <div className={card.merchant}>
    <span className={card.mono} aria-hidden="true">{Array.from(view.shop.name)[0]}</span>
    <div className={card.merchantText}><h1 className={card.merchantName}>{view.shop.name}</h1><span>Termine</span></div>
  </div>;

  return <CustomerShell brandColor={view.shop.brandColor} header={header} footer={<LegalLinks newTab />}>
    {view.blocked ? <p className={notice.notice} role="status">{PAUSED}</p> : null}

    <Mine view={view} base={base} scope={swScope} reload={reload} onMove={view.blocked ? undefined : startMove} offerPush={step !== "done"} />

    {view.blocked ? null : step === "done" && result ? <section className={styles.panel} aria-labelledby="booking-step-title">
      <h2 id="booking-step-title" ref={heading} tabIndex={-1} className={styles.panelTitle}>{result.status === "requested" ? (moving ? "Verschoben und angefragt" : "Angefragt") : moving ? "Verschoben" : "Dein Termin ist fix"}: {formatWhen(result.start, tz)} bei {result.staff.name}</h2>
      {result.status === "requested" ? <p className={card.muted}>Das Geschäft bestätigt dir {moving ? "die neue Zeit" : "den Termin"}. Ohne Bestätigung verfällt die Anfrage nach dem Termin.</p> : null}
      <p className={card.muted}>{result.service.name}. {!view.shop.cancelDeadlineHours ? "Absagen geht kostenlos bis zum Termin." : passed(Date.parse(result.cancelDeadline)) ? "Absagen geht bis zum Termin, zählt dann als kurzfristig." : `Kostenlos absagen bis ${formatWhen(result.cancelDeadline, tz)}.`}</p>
      <BookingPush base={base} scope={swScope} push={view.push} reload={reload} />
      <Link href={`/card/${encodeURIComponent(token)}`} className={buttonClassName({ block: true })}>Zur Karte</Link>
      <Button variant="quiet" size="sm" onClick={reset}>Noch einen Termin buchen</Button>
    </section> : <section className={`booking-flow ${styles.panel}`} aria-labelledby="booking-step-title">
      <div className={styles.head}>
        <h2 id="booking-step-title" ref={heading} tabIndex={-1} className={styles.panelTitle}>{moving && step === "day" ? "Neuen Tag wählen" : { service: "Leistung wählen", day: "Tag wählen", time: "Uhrzeit wählen", confirm: moving ? "Verschieben prüfen" : "Termin prüfen", done: "" }[step]}</h2>
        <p className={styles.step}>{index} von {total}</p>
      </div>
      {moving ? <p className={card.muted}>Bisher: {formatWhen(moving.start, tz)}, {moving.service.name}</p> : null}
      {service && step !== "service" && !moving ? <p className={card.muted}>{service.name} · {durationLabel(service.durationMin)} · {formatPrice(service.priceMinor, service.priceFrom)}</p> : null}

      {step === "service" ? view.services.length ? <div className={styles.rewardList}>
        {view.services.map(s => <button key={s.id} type="button" className={styles.rewardRow} onClick={() => chooseService(s)}>
          <span className={styles.rewardText}><strong>{s.name}</strong><small>{durationLabel(s.durationMin)}</small></span>
          <span className={styles.price}>{formatPrice(s.priceMinor, s.priceFrom)}</span>
        </button>)}
      </div> : <p className={card.muted}>Das Geschäft hat noch keine Leistungen online. Ruf kurz an.</p> : null}

      {step === "day" ? <>
        {showStaff ? <div className={styles.staff} role="group" aria-label="Bei wem?">
          {[{ id: "", name: "Egal wer" }, ...staffForService].map(s => <button key={s.id} type="button" className={styles.chip} aria-pressed={staffId === s.id} onClick={() => chooseStaff(s.id)}>{s.name}</button>)}
        </div> : null}
        {slotsError ? <><p className={card.alert} role="alert">{slotsError}</p><Button variant="secondary" size="sm" onClick={() => service && void loadSlots(service, staffId, moving?.id)}>Noch mal laden</Button></>
          : !days ? <div className={styles.chips} aria-busy="true" aria-label="Freie Tage werden geladen.">{[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} height={44} radius={14} />)}</div>
          : !days.length ? <>
            <p className={card.muted}>{showStaff && staffId && staffName(staffId) ? `Bei ${staffName(staffId)} ist in den nächsten ${range?.span ?? WINDOW} Tagen nichts frei. Wähl „Egal wer“.` : `In den nächsten ${range?.span ?? WINDOW} Tagen ist online nichts frei.${moreDays ? "" : " Ruf kurz im Geschäft an."}`}</p>
            {moreDays}
          </>
          : <>
            <div className={styles.chips}>{shown.map(d => <button key={d.date} type="button" className={styles.chip} aria-pressed={day?.date === d.date} onClick={() => { setDay(d); go("time"); }}>{formatDay(d.date)}</button>)}</div>
            {!allDays && days.length > 7 ? <Button variant="quiet" size="sm" onClick={() => setAllDays(true)}>Weitere Tage</Button>
              : range?.end ? <p className={card.muted}>{range.span > view.shop.maxDaysAhead ? `Online geht es bis ${view.shop.maxDaysAhead} Tage im Voraus.` : `In den ${WINDOW} Tagen danach ist online nichts frei.`}</p> : moreDays}
          </>}
      </> : null}

      {step === "time" && day ? <>
        <p className={card.muted}>{formatDay(day.date)}{staffId && staffName(staffId) ? ` bei ${staffName(staffId)}` : ""}</p>
        <div className={styles.chips}>{day.slots.map(s => <button key={s.start + s.staffId} type="button" className={`${styles.chip} ${styles.time}`} aria-pressed={slot?.start === s.start} onClick={() => chooseSlot(s)}>{formatTime(s.start, tz)}</button>)}</div>
      </> : null}

      {step === "confirm" && slot ? <>
        <p className={styles.when}><strong>{formatWhen(slot.start, tz)}</strong>{staffName(slot.staffId) ? ` bei ${staffName(slot.staffId)}` : ""}</p>
        {moving ? null : <>
          <TextField id="booking-name" required label="Dein Name" hint="Damit das Geschäft weiß, wer kommt." autoComplete="name" maxLength={60} value={contact.name} error={nameError} onChange={event => setContact({ ...contact, name: event.target.value })} />
          {showPhone ? <TextField label="Telefon (freiwillig)" type="tel" autoComplete="tel" maxLength={30} value={contact.phone} onChange={event => setContact({ ...contact, phone: event.target.value })} />
            : <Button variant="quiet" size="sm" onClick={() => setShowPhone(true)}>Telefon angeben</Button>}
        </>}
        <div className={styles.terms}>
          {ownTerms ? <p className={card.rules}>{view.shop.termsText}</p> : null}
          <p className={card.rules}>{!view.shop.cancelDeadlineHours ? "Absagen geht kostenlos bis zum Termin." : deadlinePassed ? "Die kostenlose Absagefrist ist für diese Zeit schon vorbei. Absagen geht trotzdem, zählt dann als kurzfristig." : `Kostenlos absagen bis ${formatWhen(new Date(Date.parse(slot.start) - view.shop.cancelDeadlineHours * 3_600_000).toISOString(), tz)}. Später geht es auch, zählt dann als kurzfristige Absage.`}</p>
          <p className={card.rules}>{view.shop.maxReschedulesPerMonth > 0 ? `Verschieben: bis zu ${view.shop.maxReschedulesPerMonth}-mal im Monat, bis zur Absagefrist.` : "Verschieben geht online nicht; sag ab und buch neu."}</p>
          {view.shop.autoConfirm ? null : <p className={card.rules}>Das Geschäft bestätigt deinen Termin, dann ist er fix.</p>}
          {view.shop.noShowBlockAfter > 0 ? <p className={card.rules}>Nach {missedPhrase(view.shop.noShowBlockAfter)} ohne Absage in 12 Monaten geht Online-Buchung hier nicht mehr.</p> : null}
        </div>
        <Button block loading={busy} onClick={() => void submit(slot.start, key)}>{moving ? "Hierhin verschieben" : "Termin buchen"}</Button>
      </> : null}

      {problem ? <div className={notice.notice} role="alert">
        <p>{problem.text}</p>
        {problem.nextFree ? <Button size="sm" loading={busy} onClick={() => takeNextFree(problem.nextFree!)}>{formatTime(problem.nextFree, tz)} nehmen</Button> : null}
        {problem.retry && slot ? <Button variant="secondary" size="sm" loading={busy} onClick={() => void submit(slot.start, key)}>Noch mal versuchen</Button> : null}
        {problem.pick || problem.nextFree ? <Button variant="secondary" size="sm" onClick={pickAgain}>Andere Zeit wählen</Button> : null}
      </div> : null}

      {step !== "service" ? <Button variant="quiet" size="sm" icon={<ChevronLeft size={16} />} onClick={back}>{step === "day" && moving ? "Nicht verschieben" : "Zurück"}</Button> : null}
    </section>}

    <p className={card.links}><Link href={`/card/${encodeURIComponent(token)}`}>Zurück zur Karte</Link></p>
  </CustomerShell>;
}

/** Upcoming appointments with move and cancel, then the last past ones. One line when there are none. */
function Mine({ view, base, scope, reload, onMove, offerPush }: { view: Enabled; base: string; scope: string; reload: () => Promise<void>; onMove?: (appointment: Appointment) => void; offerPush: boolean }) {
  const tz = view.shop.timezone;
  const [confirming, setConfirming] = useState<{ id: string; late: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const title = useRef<HTMLHeadingElement>(null);
  // Closing the question removes the focused button; the heading takes the focus so it is not lost to the page.
  const closeConfirm = () => { setConfirming(null); title.current?.focus(); };

  async function cancel(id: string) {
    setBusy(true); setError("");
    try { await post(`${base}/appointments/${id}/cancel`, {}); closeConfirm(); await reload(); }
    catch (cause) { setError(problemFor(cause, view).text); if (["STALE", "TOO_LATE"].includes((cause as Failure).code ?? "")) void reload(); }
    finally { setBusy(false); }
  }

  return <section className={`booking-mine ${styles.panel}`} aria-labelledby="booking-mine-title">
    <h2 id="booking-mine-title" ref={title} tabIndex={-1} className={styles.panelTitle}>Meine Termine</h2>
    {!view.upcoming.length && !view.past.length ? <p className={card.muted}>Noch keine Termine. Such dir unten einen aus.</p> : null}
    {view.upcoming.length ? <ul className={styles.list}>{view.upcoming.map(a => {
      return <li key={a.id}>
        <p className={styles.when}><strong>{formatWhen(a.start, tz)}</strong> {a.status === "requested" ? <Badge tone="warning">angefragt</Badge> : null}</p>
        <p className={card.muted}>{a.service.name} bei {a.staff.name}</p>
        {confirming?.id === a.id ? <div className={card.closeConfirm}>
          <p>{confirming.late ? "Die kostenlose Absagefrist ist vorbei. Absagen geht trotzdem, das Geschäft sieht es als kurzfristige Absage." : `Kostenlos, die Frist läuft bis ${formatWhen(a.cancelDeadline, tz)}.`}</p>
          <div className={styles.actions}>
            <Button variant="danger" size="sm" loading={busy} onClick={() => void cancel(a.id)}>Ja, absagen</Button>
            <Button variant="secondary" size="sm" autoFocus onClick={closeConfirm}>Behalten</Button>
          </div>
        </div> : <>
          {onMove && !a.canReschedule && view.shop.maxReschedulesPerMonth > 0 && passed(Date.parse(a.cancelDeadline)) && !passed(Date.parse(a.start)) ? <p className={card.muted}>Verschieben ging bis {formatWhen(a.cancelDeadline, tz)}. Ruf kurz im Geschäft an.</p> : null}
          <div className={styles.actions}>
            {a.canReschedule && onMove ? <Button variant="secondary" size="sm" onClick={() => onMove(a)}>Verschieben</Button> : null}
            {a.canCancel ? <Button variant="quiet" size="sm" onClick={() => { setError(""); setConfirming({ id: a.id, late: Date.now() >= Date.parse(a.cancelDeadline) }); }}>Absagen</Button> : null}
          </div>
        </>}
      </li>;
    })}</ul> : null}
    {error ? <p className={card.alert} role="alert">{error}</p> : null}
    {offerPush && (view.upcoming.length || view.push.subscribed || view.push.rebookConsent) ? <BookingPush base={base} scope={scope} push={view.push} reload={reload} /> : null}
    {view.past.length ? <>
      <h3 className={card.sectionHead}>Zuletzt</h3>
      <ul className={styles.list}>{view.past.map(a => <li key={a.id}><p className={card.muted}>{formatWhen(a.start, tz)}, {a.service.name}: {PAST[a.status]}{a.lateCancel ? " (kurzfristig)" : ""}</p></li>)}</ul>
    </> : null}
  </section>;
}
