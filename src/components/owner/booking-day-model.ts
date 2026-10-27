import { addDays, instantToWall, wallToInstant } from "@/lib/booking/time";

export type AppointmentStatus = "requested" | "confirmed" | "done" | "no_show" | "cancelled_by_customer" | "cancelled_by_shop";
export type OwnerAppointment = {
  id: string; status: AppointmentStatus; start: string; durationMin: number; priceMinor: number;
  service: { id: string; name: string }; staff: { id: string; name: string };
  customerName: string; customerPhone: string | null; cardLocator: string; membershipId: string; noShowCount: number; lateCancel?: boolean;
  doneAward?: { balance: number; creditedQuantity: number };
};
export type DayBlock = { id: string; staffId: string | null; start: string; end: string; reason: string };
export type DayResponse = {
  date: string; appointments: OwnerAppointment[]; blocks: DayBlock[]; staff: Array<{ id: string; name: string; sort: number }>;
  pendingRequests: number; timezone: string; blockedMembershipIds: string[]; bookingEnabled: boolean | null; nextRequestDate: string | null;
};
export type DayRow = { kind: "appointment"; at: string; appointment: OwnerAppointment; inBlock: boolean } | { kind: "block"; at: string; block: DayBlock };
export type Action = "confirm" | "done" | "no_show" | "cancel" | "move";

export const STATUS_WORD: Record<AppointmentStatus, string> = {
  requested: "angefragt", confirmed: "bestätigt", done: "erledigt", no_show: "nicht erschienen", cancelled_by_customer: "abgesagt", cancelled_by_shop: "abgesagt",
};
export const STATUS_CHIP: Record<AppointmentStatus, string> = {
  requested: "ow-chip ow-chip--warn", confirmed: "ow-chip ow-chip--info", done: "ow-chip ow-chip--ok", no_show: "ow-chip ow-chip--danger", cancelled_by_customer: "ow-chip", cancelled_by_shop: "ow-chip",
};

/** The status in words; a customer's cancel after the free deadline reads „kurzfristig abgesagt“. */
export const statusWord = (a: Pick<OwnerAppointment, "status" | "lateCancel">) => a.status === "cancelled_by_customer" && a.lateCancel ? "kurzfristig abgesagt" : STATUS_WORD[a.status];
const OPEN: AppointmentStatus[] = ["requested", "confirmed"];

/**
 * Appointments and blocks of one day in time order; at the same minute the block comes first (it explains the gap).
 * An open appointment kept inside a block of its staff member or the whole shop is marked `inBlock`.
 */
export function dayRows(day: Pick<DayResponse, "appointments" | "blocks">): DayRow[] {
  const inBlock = (a: OwnerAppointment) => {
    const start = Date.parse(a.start), end = start + a.durationMin * 60_000;
    return OPEN.includes(a.status) && day.blocks.some(b => (b.staffId === null || b.staffId === a.staff.id) && Date.parse(b.start) < end && start < Date.parse(b.end));
  };
  const rows: DayRow[] = [...day.blocks.map(block => ({ kind: "block" as const, at: block.start, block })), ...day.appointments.map(appointment => ({ kind: "appointment" as const, at: appointment.start, appointment, inBlock: inBlock(appointment) }))];
  return rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.kind === b.kind ? 0 : a.kind === "block" ? -1 : 1));
}

/** Only what the state machine allows (docs/booking-schema-api.md §4); done and no-show from 10 minutes before the start. */
export function actionsFor(status: AppointmentStatus, start?: string, now = Date.now()): Action[] {
  const all: Action[] = status === "requested" ? ["confirm", "done", "no_show", "cancel", "move"] : status === "confirmed" ? ["done", "no_show", "cancel", "move"] : [];
  const started = start === undefined || Date.parse(start) <= now + 10 * 60_000;
  return started ? all : all.filter(action => action !== "done" && action !== "no_show");
}

/** The service price as the amount field's starting value: 2500 → "25,00". */
export const euroInput = (minor: number) => (minor / 100).toFixed(2).replace(".", ",");

export function awardLine(programType: "stamp" | "points", credited: number) {
  return programType === "stamp" ? `+${credited} Stempel gutgeschrieben` : `+${credited} ${credited === 1 ? "Punkt" : "Punkte"} gutgeschrieben`;
}

export const wallTime = (iso: string, timeZone: string) => instantToWall(new Date(iso), timeZone).time;
export const todayIn = (timeZone: string) => instantToWall(new Date(), timeZone).date;
export const shiftDate = addDays;

export function dayName(date: string, today: string) {
  if (date === today) return "Heute";
  if (date === addDays(today, -1)) return "Gestern";
  if (date === addDays(today, 1)) return "Morgen";
  return new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}
/** The heading's second line: the full date under Heute/Gestern/Morgen, without the weekday under a weekday name. */
export const subLine = (date: string, today: string) => /^(Heute|Gestern|Morgen)$/.test(dayName(date, today)) ? longDate(date) : shortDate(date);
export const shortDate = (date: string) => new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
export const longDate = (date: string) => new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

/** One German line per failed action, phrased as what to do next. */
export function actionError(cause: { code?: string; status?: number; message?: string }, appointment?: Pick<OwnerAppointment, "start">, timeZone = "Europe/Berlin") {
  switch (cause.code) {
    case "STALE": return "Schon geändert, Liste aktualisiert.";
    case "TOO_EARLY": return appointment ? `Geht erst ab ${wallTime(new Date(Date.parse(appointment.start) - 10 * 60_000).toISOString(), timeZone)} Uhr.` : "Geht erst kurz vor dem Termin.";
    case "SLOT_TAKEN": return "Die Zeit ist gerade weg. Wähle eine andere.";
    case "BLOCKED": return "Diese Zeit ist geblockt. Wähle eine andere.";
    case "NOT_FOUND": return "Nicht mehr da. Liste aktualisiert.";
    case "FORBIDDEN": return "Nur Inhaber und Leitung können Termine ändern.";
  }
  // Connection and rate-limit messages from apiJson are already German.
  if ((cause.status === 0 || cause.status === 429) && cause.message) return cause.message;
  return "Das hat nicht geklappt. Versuch es noch einmal.";
}

/** "HH:MM" on `date` in the shop's zone → ISO instant; null in the spring-forward gap. */
export const wallToIso = (date: string, time: string, timeZone: string) => wallToInstant(date, time, timeZone)?.toISOString() ?? null;

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

/** The day's numbers on top: appointments that still count, open requests, and the list price of what is done (an estimate). */
export function dayTotals(appointments: OwnerAppointment[]) {
  const live = appointments.filter(a => a.status !== "cancelled_by_customer" && a.status !== "cancelled_by_shop");
  const requests = live.filter(a => a.status === "requested").length;
  const done = live.filter(a => a.status === "done");
  const parts = [live.length === 1 ? "1 Termin" : `${live.length} Termine`, requests === 1 ? "1 Anfrage" : `${requests} Anfragen`];
  if (done.length) parts.push(`${euro.format(done.reduce((sum, a) => sum + a.priceMinor, 0) / 100)} nach Listenpreis, geschätzt, nicht kassiert`);
  return parts.join(" · ");
}

/** The open-requests line: which day the next one is on, phrased from today. */
export function requestsLine(count: number, nextDate: string | null, today: string) {
  const what = count === 1 ? "1 offene Anfrage" : `${count} offene Anfragen`;
  if (!nextDate) return `${what}.`;
  const name = dayName(nextDate, today);
  return `${what}, die nächste ${/^(Heute|Gestern|Morgen)$/.test(name) ? name.toLowerCase() : `am ${name}, ${shortDate(nextDate)}`}.`;
}

/** The day as loaded, with rows the owner just changed swapped in (or out, when moved to another day) until the next load arrives. */
export const patchDay = (day: DayResponse, rows: Record<string, OwnerAppointment>): DayResponse => ({
  ...day, appointments: day.appointments.flatMap(a => !rows[a.id] ? [a] : instantToWall(new Date(rows[a.id].start), day.timezone).date === day.date ? [rows[a.id]] : []),
});
