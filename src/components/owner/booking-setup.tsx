"use client";

import { useEffect, useRef, useState } from "react";
import { apiJson, ClientApiError, newRequestId, postJson } from "@/components/client-api";
import { formatWhen } from "@/components/booking/booking-format";
import type { WorkingDay } from "@/db/schema";
import { dayProblem, defaultTerms, durationLabel, fromDays, hoursProblem, missedPhrase, parsePrice, priceText, sameHours, toDays, unionHours, WEEKDAYS, withinHours, type Day } from "./booking-setup-helpers";
import { useDirtyGuard } from "./owner-context";
import { ErrorNotice, LoadingBlock, MoreInfo, Notice, OwnerDialog, OwnerIcon, PageHead, SaveBar } from "./owner-ui";
import { useLoad } from "./use-load";

type ShopType = "nagelstudio" | "barber" | "kosmetik";
type Service = { id: string; name: string; durationMin: number; bufferMin: number; priceMinor: number; priceFrom: boolean; rebookAfterDays: number };
type Preset = { autoConfirm: boolean; workingHours: WorkingDay[]; services: Omit<Service, "id">[] };
type Rules = { leadTimeMin: number; maxDaysAhead: number; cancelDeadlineHours: number; maxReschedulesPerMonth: number; autoConfirm: boolean; noShowBlockAfter: number; maxOpenPerCard: number };
type Setup = {
  settings: (Rules & { enabled: boolean; shopType: ShopType; goalText: string; termsText: string; openingHours: WorkingDay[] | null }) | null;
  services: Service[];
  staff: { id: string; name: string; userId: string | null; workingHours: WorkingDay[]; serviceIds: string[] }[];
  presets: Record<ShopType, Preset>;
  /** After a save: open future appointments the opening hours no longer cover (Design, 22 Nov). */
  outsideHours?: OutsideAppointment[];
};
type OutsideAppointment = { id: string; status: "requested" | "confirmed"; start: string; customerName: string; serviceName: string; timezone: string };
type ServiceRow = { key: string; id?: string; name: string; durationMin: number; bufferMin: number; price: string; priceFrom: boolean; rebookAfterDays: number };
// hours null = the shop hours; serviceKeys null = every service.
type StaffRow = { key: string; id?: string; name: string; userId: string | null; hours: Day[] | null; serviceKeys: string[] | null };
type Form = { shopType: ShopType | null; goalText: string; rules: Rules; termsText: string; termsEdited: boolean; services: ServiceRow[]; hours: Day[]; staff: StaffRow[] };

const SETUP_URL = "/api/merchant/booking/setup";
const STEPS = ["Betrieb", "Leistungen", "Öffnungszeiten", "Team", "Regeln"] as const;
const SHOP_TYPES: [ShopType, string, string][] = [
  ["nagelstudio", "Nagelstudio", "Maniküre, Gel, Pediküre"],
  ["barber", "Barber", "Haarschnitt und Bart"],
  ["kosmetik", "Kosmetik", "Gesicht, Brauen, Wimpern"],
];
const DEFAULT_RULES: Rules = { leadTimeMin: 120, maxDaysAhead: 42, cancelDeadlineHours: 24, maxReschedulesPerMonth: 2, autoConfirm: true, noShowBlockAfter: 3, maxOpenPerCard: 2 };
const DURATIONS = Array.from({ length: 96 }, (_, index) => (index + 1) * 5);
const BUFFERS = Array.from({ length: 13 }, (_, index) => index * 5);
const LEAD: [number, string][] = [[0, "sofort"], [30, "30 Min. vorher"], [60, "1 Std. vorher"], [120, "2 Std. vorher"], [240, "4 Std. vorher"], [1440, "1 Tag vorher"]];
const AHEAD: [number, string][] = [[7, "1 Woche im Voraus"], [14, "2 Wochen im Voraus"], [28, "4 Wochen im Voraus"], [42, "6 Wochen im Voraus"], [90, "3 Monate im Voraus"], [180, "6 Monate im Voraus"]];
const DEADLINE: [number, string][] = [[0, "jederzeit"], [2, "bis 2 Std. vorher"], [12, "bis 12 Std. vorher"], [24, "bis 24 Std. vorher"], [48, "bis 2 Tage vorher"], [168, "bis 1 Woche vorher"]];
const RESCHEDULE: [number, string][] = [[0, "online nicht"], ...[1, 2, 3, 4, 5].map(n => [n, `${n}-mal im Monat`] as [number, string])];
const NO_SHOW: [number, string][] = [[0, "nie"], ...[1, 2, 3, 4, 5].map(n => [n, `nach ${missedPhrase(n)}`] as [number, string])];
const OPEN_PER_CARD: [number, string][] = [1, 2].map(n => [n, n === 1 ? "1 Termin" : `${n} Termine`]);
const REBOOK: [number, string][] = [[0, "Aus"], [14, "nach 2 Wochen"], [21, "nach 3 Wochen"], [28, "nach 4 Wochen"], [42, "nach 6 Wochen"], [56, "nach 8 Wochen"]];

let seq = 0;
const newKey = () => `n${++seq}`;
const withValue = (options: [number, string][], value: number, label: (n: number) => string) => options.some(([n]) => n === value) ? options : [...options, [value, label(value)] as [number, string]].sort((a, b) => a[0] - b[0]);
const serviceRow = (service: Omit<Service, "id"> & { id?: string }): ServiceRow => ({ key: service.id ?? newKey(), id: service.id, name: service.name, durationMin: service.durationMin, bufferMin: service.bufferMin, price: priceText(service.priceMinor), priceFrom: service.priceFrom, rebookAfterDays: service.rebookAfterDays });
const emptyStaff = (): StaffRow => ({ key: newKey(), name: "", userId: null, hours: null, serviceKeys: null });

function fromSetup(data: Setup): Form {
  const s = data.settings;
  const rules: Rules = s ? { leadTimeMin: s.leadTimeMin, maxDaysAhead: s.maxDaysAhead, cancelDeadlineHours: s.cancelDeadlineHours, maxReschedulesPerMonth: s.maxReschedulesPerMonth, autoConfirm: s.autoConfirm, noShowBlockAfter: s.noShowBlockAfter, maxOpenPerCard: s.maxOpenPerCard } : DEFAULT_RULES;
  // Opening hours are stored with the settings; before the first save with them, everyone's hours together stand in.
  const shopHours = s?.openingHours ?? (data.staff.length ? unionHours(data.staff.map(member => member.workingHours)) : null) ?? (s ? data.presets[s.shopType].workingHours : []);
  return {
    shopType: s?.shopType ?? null, goalText: s?.goalText ?? "", rules,
    termsText: s?.termsText || defaultTerms(rules), termsEdited: Boolean(s?.termsText && s.termsText !== defaultTerms(rules)),
    services: data.services.map(serviceRow),
    hours: toDays(shopHours),
    staff: data.staff.length ? data.staff.map(member => ({ key: member.id, id: member.id, name: member.name, userId: member.userId, hours: sameHours(member.workingHours, shopHours) ? null : toDays(member.workingHours), serviceKeys: member.serviceIds.length ? member.serviceIds : null })) : [emptyStaff()],
  };
}

/** Request body; staff services that are not saved yet are left out (empty = all) and sent in a second request. */
function payload(form: Form) {
  const ids = new Map(form.services.flatMap(service => service.id ? [[service.key, service.id]] : []));
  return {
    // Unedited terms are saved empty, so cards always show the current default wording.
    settings: { shopType: form.shopType, goalText: form.goalText.trim(), ...form.rules, termsText: form.termsEdited ? form.termsText.trim() : "", openingHours: fromDays(form.hours) },
    services: form.services.map(service => ({ id: service.id, name: service.name.trim(), durationMin: service.durationMin, bufferMin: service.bufferMin, priceMinor: parsePrice(service.price) ?? 0, priceFrom: service.priceFrom, rebookAfterDays: service.rebookAfterDays })),
    staff: form.staff.map(member => ({ id: member.id, name: member.name.trim(), userId: member.userId, workingHours: fromDays(member.hours ?? form.hours), serviceIds: (member.serviceKeys ?? []).flatMap(key => ids.has(key) ? [ids.get(key)!] : []) })),
  };
}
const needsSecondSave = (form: Form) => form.staff.some(member => member.serviceKeys?.some(key => !form.services.find(service => service.key === key)?.id));
const put = (body: unknown) => apiJson<Setup>(SETUP_URL, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** Per step: field id → problem; the first one is focused when Weiter or Speichern is blocked. */
function problems(form: Form): Record<string, string>[] {
  const services: Record<string, string> = {};
  if (!form.services.length) services["bs-add-service"] = "Füge mindestens eine Leistung hinzu.";
  form.services.forEach(service => {
    if (!service.name.trim()) services[`bs-sname-${service.key}`] = "Bitte einen Namen eingeben.";
    if (parsePrice(service.price) === null) services[`bs-price-${service.key}`] = "Preis wie 25 oder 12,50 eingeben, höchstens 1.000 €.";
  });
  const staff: Record<string, string> = {};
  if (!form.staff.length) staff["bs-add-staff"] = "Mindestens eine Person muss Termine annehmen.";
  form.staff.forEach(member => {
    if (!member.name.trim()) staff[`bs-pname-${member.key}`] = "Bitte einen Namen eingeben.";
    if (member.hours && (hoursProblem(member.hours) || withinHours(member.hours, form.hours))) staff[`bs-phours-${member.key}`] = hoursProblem(member.hours) || withinHours(member.hours, form.hours);
    if (member.serviceKeys && !member.serviceKeys.length) staff[`bs-pserv-${member.key}`] = "Wähle mindestens eine Leistung.";
  });
  return [
    { "bs-type-nagelstudio": form.shopType ? "" : "Wähle deinen Betrieb." },
    services,
    { "bs-hours": hoursProblem(form.hours) },
    staff,
    {},
  ].map(group => Object.fromEntries(Object.entries(group).filter(([, message]) => message)));
}

function saveMessage(cause: unknown) {
  if (!(cause instanceof ClientApiError) || cause.status === 0 || cause.status >= 500) return "Nicht bestätigt, ob gespeichert wurde. Lade die Seite neu und prüfe den Stand.";
  if (cause.status === 401) return "Deine Anmeldung ist abgelaufen. Melde dich erneut an.";
  if (cause.code === "FORBIDDEN") return "Nur die Inhaberin oder der Inhaber kann die Online-Termine einrichten.";
  if (cause.code === "NOT_FOUND" || cause.code === "INVALID_SERVICE") return "Die Einrichtung wurde inzwischen woanders geändert. Lade die Seite neu.";
  if (cause.status === 429) return "Zu viele Anfragen. Warte kurz und versuche es erneut.";
  return "Nicht gespeichert. Prüfe die Angaben und versuche es erneut.";
}

export function BookingSetup() {
  const [loaded, reload] = useLoad<Setup>(SETUP_URL);
  if (loaded.state === "error") return <div className="ow-page"><ErrorNotice message={loaded.message} onRetry={reload} /></div>;
  if (loaded.state !== "ok") return <div className="ow-page"><LoadingBlock rows={3} /></div>;
  return <Wizard initial={loaded.data} />;
}

function Wizard({ initial }: { initial: Setup }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const focusedStep = useRef(0);
  const [data, setData] = useState(initial);
  const [form, setForm] = useState(() => fromSetup(initial));
  const [baseline, setBaseline] = useState(() => initial.settings ? JSON.stringify(payload(fromSetup(initial))) : "");
  const returning = Boolean(data.settings);
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(returning ? STEPS.length - 1 : 0);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [outside, setOutside] = useState<OutsideAppointment[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<{ staffId: string; name: string; count: number }[] | null>(null);
  const [serviceBusy, setServiceBusy] = useState<{ serviceId: string; name: string; count: number } | null>(null);
  const [savedOnce, setSavedOnce] = useState(false);
  const dirty = JSON.stringify(payload(form)) !== baseline;
  useDirtyGuard("booking-setup", dirty && !saving);
  // The heading takes focus when the step changes, not when the page opens.
  useEffect(() => { if (focusedStep.current === step) return; focusedStep.current = step; heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: "start" }); }, [step]);

  const all = problems(form);
  const err = (id: string) => tried ? all[step][id] ?? "" : "";
  const update = (change: (current: Form) => Form) => { setError(""); setSavedOnce(false); setForm(change); };
  const set = (patch: Partial<Form>) => update(current => ({ ...current, ...patch }));
  const setRules = (patch: Partial<Rules>) => update(current => ({ ...current, rules: { ...current.rules, ...patch } }));
  const setService = (key: string, patch: Partial<ServiceRow>) => update(current => ({ ...current, services: current.services.map(service => service.key === key ? { ...service, ...patch } : service) }));
  const setStaff = (key: string, patch: Partial<StaffRow>) => update(current => ({ ...current, staff: current.staff.map(member => member.key === key ? { ...member, ...patch } : member) }));

  function focusFirst(group: Record<string, string>) {
    const [id] = Object.keys(group);
    requestAnimationFrame(() => { const field = document.getElementById(id); field?.closest("details")?.setAttribute("open", ""); field?.focus(); });
  }
  function go(target: number) {
    if (target > step && Object.keys(all[step]).length) { setTried(true); focusFirst(all[step]); return; }
    setTried(false); setStep(target); setReached(value => Math.max(value, target));
  }
  function choosePreset(type: ShopType) {
    if (returning) { set({ shopType: type }); return; }
    const preset = data.presets[type];
    const rules = { ...form.rules, autoConfirm: preset.autoConfirm };
    set({ shopType: type, rules, services: preset.services.map(serviceRow), hours: toDays(preset.workingHours), staff: form.staff.map(member => ({ ...member, hours: null, serviceKeys: null })) });
  }

  async function save(next: Form = form) {
    const failing = problems(next).findIndex(group => Object.keys(group).length);
    if (failing >= 0) { setTried(true); setStep(failing); focusFirst(problems(next)[failing]); return; }
    setSaving(true); setError(""); setBusy(null); setServiceBusy(null);
    try {
      let result = await put(payload(next));
      // New services get their ids from the first save; staff limited to some of them need a second one.
      if (needsSecondSave(next)) result = await put(payload({ ...next, services: next.services.map((service, index) => ({ ...service, id: result.services[index].id })), staff: next.staff.map((member, index) => ({ ...member, id: result.staff[index].id })) }));
      const fresh = fromSetup(result);
      setData(result); setForm(fresh); setBaseline(JSON.stringify(payload(fresh))); setReached(STEPS.length - 1); setSavedOnce(true);
      if (result.outsideHours?.length) setOutside(result.outsideHours);
    } catch (cause) {
      const body = cause instanceof ClientApiError ? cause.body : undefined;
      if (cause instanceof ClientApiError && cause.code === "STAFF_HAS_APPOINTMENTS" && typeof body?.staffId === "string") {
        const all: unknown[] = Array.isArray(body.all) ? body.all : [{ staffId: body.staffId, count: body.count }];
        setBusy(all.flatMap(item => {
          const { staffId, count } = (item ?? {}) as { staffId?: unknown; count?: unknown };
          return typeof staffId === "string" ? [{ staffId, name: data.staff.find(member => member.id === staffId)?.name ?? "Diese Person", count: Number(count) || 1 }] : [];
        }));
        setStep(3);
      } else if (cause instanceof ClientApiError && cause.code === "SERVICE_HAS_APPOINTMENTS" && typeof body?.serviceId === "string") {
        const serviceId = body.serviceId;
        setServiceBusy({ serviceId, name: data.services.find(service => service.id === serviceId)?.name ?? "Diese Leistung", count: Number(body.count) || 1 });
        setStep(1);
      } else setError(saveMessage(cause));
    } finally { setSaving(false); }
  }
  function keep() {
    const shopHours = fromDays(form.hours);
    const back = data.staff.filter(member => busy?.some(item => item.staffId === member.id) && !form.staff.some(row => row.id === member.id));
    const next = { ...form, staff: [...form.staff, ...back.map(member => ({ key: member.id, id: member.id, name: member.name, userId: member.userId, hours: sameHours(member.workingHours, shopHours) ? null : toDays(member.workingHours), serviceKeys: member.serviceIds.length ? member.serviceIds.filter(id => form.services.some(service => service.id === id)) : null }))] };
    setForm(next); void save(next);
  }
  function keepService() {
    const service = data.services.find(item => item.id === serviceBusy?.serviceId);
    if (!service || form.services.some(row => row.id === service.id)) return;
    // People who offered it before offer it again.
    const next = { ...form, services: [...form.services, serviceRow(service)], staff: form.staff.map(member => member.serviceKeys && data.staff.find(item => item.id === member.id)?.serviceIds.includes(service.id) ? { ...member, serviceKeys: [...member.serviceKeys, service.id] } : member) };
    setForm(next); void save(next);
  }

  const last = step === STEPS.length - 1;
  const saveState = saving ? "saving" : error || busy || serviceBusy ? "error" : dirty ? "dirty" : savedOnce ? "saved" : "clean";
  const showSave = returning || last;
  const r = form.rules;

  return (
    <div className="ow-page">
      <PageHead title="Online-Buchung einrichten" lead={returning ? "Ändere, was nicht mehr stimmt, und speichere. Gebuchte Termine bleiben, wie sie sind." : "Fünf kurze Schritte. Gespeichert wird erst am Ende."} />
      <ol className="ow-stepper" aria-label="Fortschritt">
        {STEPS.map((label, index) => (
          <li key={label} aria-current={index === step ? "step" : undefined} data-done={index < step || (returning && index !== step)} style={{ padding: 0 }}>
            <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" style={{ color: "inherit", paddingLeft: "var(--space-2)" }} disabled={index > reached} onClick={() => go(index)}>
              <span className="ow-stepper-n">{index < step || (returning && index !== step) ? <OwnerIcon name="check" size={16} /> : index + 1}</span>{label}
            </button>
          </li>
        ))}
      </ol>
      {/* D8 (Design, 22 Nov): each step arrives in place (Arrive, an 8 px rise over --dur-ui), cut under reduced motion. */}
      <form key={step} className="ow-card ow-stack ow-prog ow-arrive" style={{ gap: "var(--space-5)" }} noValidate onSubmit={event => { event.preventDefault(); if (last) void save(); else go(step + 1); }}>
        {step === 0 && <>
          <div><h2 ref={heading} tabIndex={-1}>Was für ein Betrieb bist du?</h2><p className="ow-hint">{returning ? "Ändert nur die Art. Deine Leistungen und Zeiten bleiben." : "Füllt Leistungen und Zeiten mit Beispielen vor. Alles bleibt änderbar."}</p></div>
          <div className="ow-radio-cards" role="radiogroup" aria-label="Betriebsart" aria-describedby={err("bs-type-nagelstudio") ? "bs-type-error" : undefined}>
            {SHOP_TYPES.map(([type, title, text]) => <label key={type} className="ow-radio-card"><input id={`bs-type-${type}`} type="radio" name="bs-type" checked={form.shopType === type} onChange={() => choosePreset(type)} /><div><strong>{title}</strong><span>{text}</span></div></label>)}
          </div>
          {err("bs-type-nagelstudio") && <span id="bs-type-error" className="ow-error" role="alert">{err("bs-type-nagelstudio")}</span>}
          <Field id="bs-goal" label="Dein Ziel für die ersten vier Wochen" hint="In deinen Worten. Es steht oben in der Tagesansicht.">
            <input id="bs-goal" className="ow-input" value={form.goalText} maxLength={140} placeholder="z. B. 20 Online-Termine pro Woche" onChange={event => set({ goalText: event.target.value })} />
          </Field>
        </>}

        {step === 1 && <>
          <div><h2 ref={heading} tabIndex={-1}>Deine Leistungen</h2><p className="ow-hint">Kunden sehen Name, Dauer und Preis.</p></div>
          {serviceBusy && <Notice tone="warn" role="alert" actions={<button type="button" className="ow-btn ow-btn--sm ow-btn--secondary" onClick={keepService} disabled={saving}>{serviceBusy.name} behalten</button>}>
            {serviceBusy.name} hat noch {serviceBusy.count === 1 ? "1 offenen Termin" : `${serviceBusy.count} offene Termine`}. Nichts wurde gespeichert. {serviceBusy.count === 1 ? "Sag ihn erst in „Termine“ ab" : "Sag sie erst in „Termine“ ab"} oder lass die Leistung bis dahin drin.
          </Notice>}
          {form.services.length === 0 && <p className="ow-muted">Noch keine Leistung. Füge mindestens eine hinzu.</p>}
          <ul className="ow-rewards">
            {form.services.map((service, index) => (
              <li key={service.key} className="ow-stack" style={{ gap: "var(--space-3)", padding: "var(--space-4) 0", borderTop: index ? "1px solid var(--color-line)" : 0 }}>
                <Field id={`bs-sname-${service.key}`} label="Name" error={err(`bs-sname-${service.key}`)}>
                    <input id={`bs-sname-${service.key}`} className="ow-input" value={service.name} maxLength={80} aria-invalid={Boolean(err(`bs-sname-${service.key}`))} onChange={event => setService(service.key, { name: event.target.value })} />
                </Field>
                {/* Two columns even at 390 px: a service stays one short block on the phone. */}
                <div className="ow-grid-2" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                  <Field id={`bs-dur-${service.key}`} label="Dauer">
                    <select id={`bs-dur-${service.key}`} className="ow-select" value={service.durationMin} onChange={event => setService(service.key, { durationMin: Number(event.target.value) })}>
                      {DURATIONS.map(minutes => <option key={minutes} value={minutes}>{durationLabel(minutes)}</option>)}
                    </select>
                  </Field>
                  <Field id={`bs-price-${service.key}`} label="Preis in Euro" error={err(`bs-price-${service.key}`)}>
                    <input id={`bs-price-${service.key}`} className="ow-input" inputMode="decimal" value={service.price} aria-invalid={Boolean(err(`bs-price-${service.key}`))} onChange={event => setService(service.key, { price: event.target.value })} />
                  </Field>
                </div>
                <div className="ow-row" style={{ justifyContent: "space-between" }}>
                  <label className="ow-check"><input type="checkbox" checked={service.priceFrom} onChange={event => setService(service.key, { priceFrom: event.target.checked })} /> „ab“ vor dem Preis</label>
                  <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" aria-label={`${service.name || "Leistung"} entfernen`} onClick={() => set({ services: form.services.filter(item => item.key !== service.key), staff: form.staff.map(member => member.serviceKeys ? { ...member, serviceKeys: member.serviceKeys.filter(key => key !== service.key) } : member) })}>Entfernen</button>
                </div>
                <MoreInfo summary="Mehr">
                  <div className="ow-grid-2" style={{ color: "var(--color-ink)" }}>
                    <Field id={`bs-buf-${service.key}`} label="Puffer danach" hint="Kunden sehen ihn nicht.">
                      <select id={`bs-buf-${service.key}`} className="ow-select" value={service.bufferMin} onChange={event => setService(service.key, { bufferMin: Number(event.target.value) })}>
                        {BUFFERS.map(minutes => <option key={minutes} value={minutes}>{minutes ? durationLabel(minutes) : "kein Puffer"}</option>)}
                      </select>
                    </Field>
                    <Choice id={`bs-rebook-${service.key}`} label="Zum nächsten Termin einladen" hint="Nur Kunden, die Erinnerungen angeschaltet haben." value={service.rebookAfterDays} options={withValue(REBOOK, service.rebookAfterDays, n => `nach ${n} Tagen`)} onChange={rebookAfterDays => setService(service.key, { rebookAfterDays })} />
                  </div>
                </MoreInfo>
              </li>
            ))}
          </ul>
          <div><button id="bs-add-service" type="button" className="ow-btn ow-btn--secondary" onClick={() => set({ services: [...form.services, { key: newKey(), name: "", durationMin: 30, bufferMin: 0, price: "", priceFrom: false, rebookAfterDays: 0 }] })}><OwnerIcon name="plus" size={20} />Leistung hinzufügen</button></div>
          {err("bs-add-service") && <span className="ow-error" role="alert">{err("bs-add-service")}</span>}
        </>}

        {step === 2 && <>
          <div><h2 ref={heading} tabIndex={-1}>Öffnungszeiten</h2><p className="ow-hint">Wer zu den Öffnungszeiten arbeitet, ist in diesen Zeiten buchbar. Eigene Zeiten im Team müssen darin liegen, Pausen dürfen abweichen.</p></div>
          <HoursEditor id="bs-hours" days={form.hours} onChange={hours => set({ hours })} error={err("bs-hours")} />
        </>}

        {step === 3 && <>
          <div><h2 ref={heading} tabIndex={-1}>Wer nimmt Termine an?</h2><p className="ow-hint">Kunden wählen eine Person oder „egal wer“.</p></div>
          {busy && busy.length > 0 && <Notice tone="warn" role="alert" actions={<button type="button" className="ow-btn ow-btn--sm ow-btn--secondary" onClick={keep} disabled={saving}>{busy.length === 1 ? `${busy[0].name} behalten` : "Alle behalten"}</button>}>
            {busy.length === 1
              ? `${busy[0].name} hat noch ${busy[0].count === 1 ? "1 offenen Termin" : `${busy[0].count} offene Termine`}.`
              : `${busy.map(item => `${item.name} (${item.count})`).join(", ").replace(/, ([^,]*)$/, " und $1")} haben noch offene Termine.`} Nichts wurde gespeichert. {busy.length === 1 && busy[0].count === 1 ? "Sag ihn erst in „Termine“ ab oder verschiebe ihn." : "Sag sie erst in „Termine“ ab oder verschiebe sie."}
          </Notice>}
          <ul className="ow-rewards">
            {form.staff.map((member, index) => (
              <li key={member.key} className="ow-stack" style={{ gap: "var(--space-3)", padding: "var(--space-4) 0", borderTop: index ? "1px solid var(--color-line)" : 0 }}>
                <Field id={`bs-pname-${member.key}`} label="Name" error={err(`bs-pname-${member.key}`)}>
                  <input id={`bs-pname-${member.key}`} className="ow-input" value={member.name} maxLength={60} placeholder="z. B. Lena" aria-invalid={Boolean(err(`bs-pname-${member.key}`))} onChange={event => setStaff(member.key, { name: event.target.value })} />
                </Field>
                <label className="ow-check"><input type="checkbox" role="switch" checked={member.hours === null} onChange={event => setStaff(member.key, { hours: event.target.checked ? null : form.hours })} /> Arbeitet zu den Öffnungszeiten</label>
                {member.hours && <HoursEditor id={`bs-phours-${member.key}`} days={member.hours} onChange={hours => setStaff(member.key, { hours })} error={err(`bs-phours-${member.key}`)} />}
                <label className="ow-check"><input type="checkbox" role="switch" checked={member.serviceKeys === null} onChange={event => setStaff(member.key, { serviceKeys: event.target.checked ? null : form.services.map(service => service.key) })} /> Bietet alle Leistungen an</label>
                {member.serviceKeys && <fieldset className="ow-group" id={`bs-pserv-${member.key}`} tabIndex={-1}>
                  <legend className="ow-sr">Leistungen von {member.name || "dieser Person"}</legend>
                  {form.services.map(service => <label key={service.key} className="ow-check" style={{ fontWeight: "var(--weight-label)" }}><input type="checkbox" checked={member.serviceKeys!.includes(service.key)} onChange={event => setStaff(member.key, { serviceKeys: event.target.checked ? [...member.serviceKeys!, service.key] : member.serviceKeys!.filter(key => key !== service.key) })} />{service.name || "Ohne Namen"}</label>)}
                  {err(`bs-pserv-${member.key}`) && <span className="ow-error" role="alert">{err(`bs-pserv-${member.key}`)}</span>}
                </fieldset>}
                {form.staff.length > 1 && <div><button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" aria-label={`${member.name || "Person"} entfernen`} onClick={() => set({ staff: form.staff.filter(item => item.key !== member.key) })}>Entfernen</button></div>}
              </li>
            ))}
          </ul>
          <div><button id="bs-add-staff" type="button" className="ow-btn ow-btn--secondary" onClick={() => set({ staff: [...form.staff, emptyStaff()] })}><OwnerIcon name="plus" size={20} />Person hinzufügen</button></div>
        </>}

        {step === 4 && <>
          <div><h2 ref={heading} tabIndex={-1}>Deine Regeln</h2><p className="ow-hint">Kunden lesen sie vor dem Buchen.</p></div>
          <div className="ow-radio-cards" role="radiogroup" aria-label="Neue Termine">
            <label className="ow-radio-card"><input type="radio" name="bs-confirm" checked={r.autoConfirm} onChange={() => setRules({ autoConfirm: true })} /><div><strong>Sofort fix</strong><span>Termine sind sofort fix, du siehst sie in der Tagesansicht. Jede freie Zeit ist sofort weg, du prüfst nichts vorher.</span></div></label>
            <label className="ow-radio-card"><input type="radio" name="bs-confirm" checked={!r.autoConfirm} onChange={() => setRules({ autoConfirm: false })} /><div><strong>Ich bestätige selbst</strong><span>Du bestätigst jede Anfrage selbst; bis dahin ist der Termin nicht fix. Anfragen, die du nicht bestätigst, verfallen nach dem Termin; der Kunde bekommt eine Mitteilung, wenn er Erinnerungen an hat, sonst sieht er es auf seiner Karte.</span></div></label>
          </div>
          <div className="ow-grid-2">
            <Choice id="bs-lead" label="Buchbar frühestens" value={r.leadTimeMin} options={withValue(LEAD, r.leadTimeMin, n => `${n} Min. vorher`)} onChange={leadTimeMin => setRules({ leadTimeMin })} />
            <Choice id="bs-ahead" label="Buchbar bis" value={r.maxDaysAhead} options={withValue(AHEAD, r.maxDaysAhead, n => `${n} Tage im Voraus`)} onChange={maxDaysAhead => setRules({ maxDaysAhead })} />
            <Choice id="bs-deadline" label="Kostenlos absagen" hint="Später geht auch, zählt dann als kurzfristig abgesagt." value={r.cancelDeadlineHours} options={withValue(DEADLINE, r.cancelDeadlineHours, n => `bis ${n} Std. vorher`)} onChange={cancelDeadlineHours => setRules({ cancelDeadlineHours })} />
            <Choice id="bs-reschedule" label="Verschieben" value={r.maxReschedulesPerMonth} options={withValue(RESCHEDULE, r.maxReschedulesPerMonth, n => `${n}-mal im Monat`)} onChange={maxReschedulesPerMonth => setRules({ maxReschedulesPerMonth })} />
          </div>
          <Choice id="bs-open" label="Offene Termine pro Kunde" hint="So viele Termine kann ein Kunde gleichzeitig gebucht haben." value={r.maxOpenPerCard} options={withValue(OPEN_PER_CARD, r.maxOpenPerCard, n => `${n} Termine`)} onChange={maxOpenPerCard => setRules({ maxOpenPerCard })} />
          <Choice id="bs-noshow" label="Kunden sperren" value={r.noShowBlockAfter} options={withValue(NO_SHOW, r.noShowBlockAfter, n => `nach ${missedPhrase(n)}`)} onChange={noShowBlockAfter => setRules({ noShowBlockAfter })}
            hint={r.noShowBlockAfter ? `Wer ${r.noShowBlockAfter}-mal in 12 Monaten ohne Absage fehlt, kann nur noch anrufen. Du hebst das mit einem Tipp auf.` : "Niemand wird pausiert, auch nach vielen verpassten Terminen nicht."} />
          <Field id="bs-terms" label="Text für deine Kunden" hint={form.termsEdited ? "Dein eigener Text. Prüfe ihn, wenn du die Regeln änderst." : "Folgt deinen Regeln. Du kannst ihn frei ändern."}>
            <textarea id="bs-terms" className="ow-textarea" rows={5} maxLength={600} value={form.termsEdited ? form.termsText : defaultTerms(r)} onChange={event => set({ termsText: event.target.value, termsEdited: true })} />
          </Field>
          {form.termsEdited && <div><button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" onClick={() => set({ termsEdited: false })}>Vorschlag wiederherstellen</button></div>}
        </>}

        {error && <Notice tone="danger" role="alert">{error} Deine Eingaben sind noch da.</Notice>}
        <div className="ow-row" style={{ justifyContent: "space-between" }}>
          {step > 0 ? <button type="button" className="ow-btn ow-btn--ghost" onClick={() => go(step - 1)} disabled={saving}>Zurück</button> : <span />}
          {!last && <button type="submit" className="ow-btn ow-btn--primary">Weiter</button>}
        </div>
      </form>
      {outside && <OutsideHoursDialog appointments={outside} onClose={() => setOutside(null)} />}
      {showSave && <SaveBar state={saveState} onSave={() => void save()} canSave={!saving} errorLabel={busy || serviceBusy ? "Nicht gespeichert" : undefined} detail={saveState === "dirty" && !returning ? "Erst mit Speichern ist alles übernommen." : undefined} />}
    </div>
  );
}

function HoursEditor({ id, days, onChange, error }: { id: string; days: Day[]; onChange: (days: Day[]) => void; error?: string }) {
  const setDay = (index: number, patch: Partial<Day>) => onChange(days.map((day, i) => i === index ? { ...day, ...patch } : day));
  const first = days.findIndex(day => day.open);
  return (
    <div className="ow-stack" id={id} tabIndex={-1} style={{ gap: "var(--space-3)" }}>
      {days.map((day, index) => {
        const problem = dayProblem(day);
        return (
          <fieldset key={WEEKDAYS[index]} className="ow-group" style={{ gap: "var(--space-2)" }}>
            <legend className="ow-sr">{WEEKDAYS[index]}</legend>
            <label className="ow-check"><input type="checkbox" role="switch" checked={day.open} onChange={event => setDay(index, { open: event.target.checked })} /> {WEEKDAYS[index]}{!day.open && <span className="ow-muted" style={{ fontWeight: "var(--weight-label)" }}>geschlossen</span>}</label>
            {day.open && <>
              <div className="ow-row" style={{ gap: "var(--space-2)" }}>
                <input type="time" step={300} className="ow-input" style={{ width: "auto" }} aria-label={`${WEEKDAYS[index]} ab`} value={day.start} onChange={event => setDay(index, { start: event.target.value })} />
                <span aria-hidden="true">–</span>
                <input type="time" step={300} className="ow-input" style={{ width: "auto" }} aria-label={`${WEEKDAYS[index]} bis`} value={day.end} onChange={event => setDay(index, { end: event.target.value })} />
              </div>
              {day.breakStart || day.breakEnd ? <div className="ow-row" style={{ gap: "var(--space-2)" }}>
                <span className="ow-hint" style={{ minWidth: 48 }}>Pause</span>
                <input type="time" step={300} className="ow-input" style={{ width: "auto" }} aria-label={`${WEEKDAYS[index]} Pause ab`} value={day.breakStart} onChange={event => setDay(index, { breakStart: event.target.value })} />
                <span aria-hidden="true">–</span>
                <input type="time" step={300} className="ow-input" style={{ width: "auto" }} aria-label={`${WEEKDAYS[index]} Pause bis`} value={day.breakEnd} onChange={event => setDay(index, { breakEnd: event.target.value })} />
                <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" aria-label={`${WEEKDAYS[index]} ohne Pause`} onClick={() => setDay(index, { breakStart: "", breakEnd: "" })}><OwnerIcon name="close" size={20} /></button>
              </div> : null}
              {problem && <span className="ow-error">{problem}</span>}
              <div className="ow-row" style={{ gap: "var(--space-2)" }}>
                {!day.breakStart && !day.breakEnd && <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" onClick={() => setDay(index, { breakStart: "13:00", breakEnd: "13:30" })}><OwnerIcon name="plus" size={20} />Pause hinzufügen</button>}
                {index === first && <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" onClick={() => onChange(days.map(other => other.open ? { ...day } : other))}>Für alle Tage übernehmen</button>}
              </div>
            </>}
          </fieldset>
        );
      })}
      {error && <span className="ow-error" role="alert">{error}</span>}
    </div>
  );
}

function Choice({ id, label, hint, value, options, onChange }: { id: string; label: string; hint?: string; value: number; options: [number, string][]; onChange: (value: number) => void }) {
  return <Field id={id} label={label} hint={hint}><select id={id} className="ow-select" value={value} onChange={event => onChange(Number(event.target.value))}>{options.map(([n, text]) => <option key={n} value={n}>{text}</option>)}</select></Field>;
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return <div className="ow-field"><label htmlFor={id}>{label}</label>{children}{hint && !error && <span className="ow-hint">{hint}</span>}{error && <span className="ow-error" role="alert">{error}</span>}</div>;
}

/** After closing hours that held appointments: the block sheet's question, keep them or cancel them all (Design, 22 Nov). */
function OutsideHoursDialog({ appointments, onClose }: { appointments: OutsideAppointment[]; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function cancelAll() {
    setBusy(true); setError("");
    try {
      for (const a of appointments) await postJson(`/api/merchant/booking/appointments/${a.id}/transition`, { to: "cancelled_by_shop", expected: a.status, reason: "Geschäft geschlossen", idempotencyKey: newRequestId() }).catch(cause => { if (!(cause instanceof ClientApiError && cause.code === "STALE")) throw cause; });
      onClose();
    } catch { setError("Nicht alle Termine konnten abgesagt werden. Sieh in der Tagesansicht nach."); }
    finally { setBusy(false); }
  }
  return <OwnerDialog title={appointments.length === 1 ? "1 Termin liegt außerhalb der Öffnungszeiten" : `${appointments.length} Termine liegen außerhalb der Öffnungszeiten`} tone="danger" onClose={onClose}
    actions={<><button type="button" className="ow-btn ow-btn--ghost" onClick={onClose} disabled={busy} data-autofocus>Termine behalten</button><button type="button" className="ow-btn ow-btn--danger" onClick={() => void cancelAll()} disabled={busy} aria-busy={busy}>Alle absagen</button></>}>
    <p>Gespeichert. Diese Termine bleiben, bis du sie absagst; die Kunden bekommen dann eine Mitteilung.</p>
    <ul className="ow-feed">{appointments.map(a => <li key={a.id}><span><strong className="ow-num">{formatWhen(a.start, a.timezone)}</strong>, {a.serviceName}, {a.customerName}</span></li>)}</ul>
    {error && <p className="ow-error" role="alert">{error}</p>}
  </OwnerDialog>;
}
