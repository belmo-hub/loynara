import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { contractBasis, contractFacts, customerText, factsLines } from "./contract-end";
import { operatorIdentity } from "./operator-identity";
import { surfaceHidden } from "./pilot-surfaces";
import { vatMode } from "./stripe-config";
import { emailTransportMode, sendTransactional, type TransactionalEmailProvider } from "./transactional-email";

type Query = { execute: typeof db.execute };

/**
 * ENG-167 (Legal, 1 Nov; Marketing's M1–M3): the owner's emails about the contract end. M1 goes out when a cancellation
 * reaches us (in the app, or entered by the operator from an e-mail) and is the text-form confirmation; M2 when the end is
 * moved later with the shop's consent; M3 on a withdrawal. Each is one outbox job written in the same transaction as the
 * change, and sends at most once (the transactional reservation is keyed by the job id). The facts come from contractFacts,
 * the same function as the screens.
 */
export const CONTRACT_END_EMAIL = "email.contract_end";
const payload = z.object({
  event: z.enum(["received", "changed", "withdrawn"]),
  endDate: z.iso.date().nullable(),
  receivedAt: z.iso.datetime({ offset: true }).nullable(),
  requestDay: z.iso.date().nullable(),
}).strict();
export type ContractEndEvent = z.infer<typeof payload>;

export async function queueContractEndEmail(tx: Query, tenantId: string, event: ContractEndEvent) {
  await tx.execute(sql`INSERT INTO outbox_jobs (tenant_id, kind, payload) VALUES (${tenantId}::uuid, ${CONTRACT_END_EMAIL}, ${JSON.stringify(payload.parse(event))}::jsonb)`);
}

const berlin = (at: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", ...options }).format(at);
const euros = (minor: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const list = (names: string[]) => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} und ${names.at(-1)}`;

export async function deliverContractEndEmail(job: { id: string; tenantId: string; payload: Record<string, unknown> }, provider?: TransactionalEmailProvider, now = new Date()) {
  if (emailTransportMode() === "disabled") return { status: "blocked" as const, reason: "Transactional email unavailable" };
  const parsed = payload.safeParse(job.payload);
  if (!parsed.success) return { status: "blocked" as const, reason: "Invalid contract-end email job" };
  // The footer names the operator (Legal, Q-93), from the operator's own settings, so it never waits on live billing (CTO).
  const operator = operatorIdentity();
  if (!operator) return { status: "blocked" as const, reason: "Operator name or address unavailable (OPERATOR_NAME, OPERATOR_ADDRESS)" };
  const { rows } = await db.execute(sql`SELECT u.email, t.name AS shop, (SELECT p.type FROM programs p WHERE p.tenant_id = t.id ORDER BY p.created_at LIMIT 1) AS type
    FROM staff_roles o JOIN "user" u ON u.id = o.user_id JOIN tenants t ON t.id = o.tenant_id
    WHERE o.tenant_id = ${job.tenantId} AND o.role = 'owner' AND o.active ORDER BY o.created_at LIMIT 1`);
  const owner = rows[0] as { email: string; shop: string; type: string } | undefined;
  if (!owner) return { status: "suppressed" as const, reason: "No owner to write to" };
  const text = await contractEndEmailText({ tenantId: job.tenantId, shop: owner.shop, unit: owner.type === "stamp" ? "Stempel" : "Punkte", event: parsed.data, operator, now });
  if (!text) return { status: "suppressed" as const, reason: "Shop not found" };
  // Reserved by job id before the provider is called: a retried or replayed job never sends a second mail.
  return sendTransactional({ to: owner.email, jobId: job.id, ...text }, provider);
}

/** Marketing's M1–M3 text with Legal's conditions (received time in Berlin, the card line, the operator footer). */
export async function contractEndEmailText(input: { tenantId: string; shop: string; unit: "Stempel" | "Punkte"; event: ContractEndEvent; operator: { name: string; address: string }; now: Date; env?: Record<string, string | undefined> }) {
  const env = input.env ?? process.env;
  const shop = clean(input.shop);
  // The address may come on several lines (a real line break, or „\n“ typed into a single-line setting): one footer line.
  const address = input.operator.address.split(/\r?\n|\\n/).map(clean).filter(Boolean).join(", ");
  const footer = ["", "Viele Grüße", "Loynara", "", `${clean(input.operator.name)} · ${address}`];
  if (input.event.event === "withdrawn") {
    const basis = await contractBasis(input.tenantId);
    if (!basis) return null;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(input.now);
    const billing = basis.totalMinor === null || !basis.billed ? null
      : basis.lastFreeDay && today <= basis.lastFreeDay ? `Nach dem kostenlosen Monat beginnt die Abrechnung am ${germanDay(basis.firstBillingDay!)}, ${euros(basis.totalMinor)} im Monat.`
        : `Die Abrechnung bleibt wie bisher: nächste Rechnung am ${germanDay(nextBilling(today, basis.anchorDay))}, ${euros(basis.totalMinor)}.`;
    return {
      subject: `${shop}: Dein Programm läuft weiter`,
      body: ["Hallo,", "", "deine Kündigung ist zurückgenommen. Dein Programm läuft ohne Enddatum weiter.", ...(billing ? ["", billing] : []), ...footer].join("\n"),
    };
  }
  const endDate = input.event.endDate!;
  const facts = await contractFacts(input.tenantId, endDate, input.now, input.event.requestDay ?? undefined);
  if (!facts) return null;
  const lines = factsLines(facts, vatMode(), env);
  const received = input.event.receivedAt ? new Date(input.event.receivedAt) : input.now;
  const first = input.event.event === "received"
    ? `wir haben deine Kündigung am ${berlin(received, { day: "2-digit", month: "2-digit", year: "numeric" })} um ${berlin(received, { hour: "2-digit", minute: "2-digit" })} Uhr erhalten. Dein Programm endet am ${lines.lastDay.value}. Das gilt jetzt:`
    : "dein Enddatum hat sich geändert. Das gilt jetzt:";
  const withdraw = surfaceHidden("cancellation", env)
    ? "Möchtest du doch weitermachen? Solange dein Programm läuft, kannst du die Kündigung zurücknehmen. Schreibe uns dazu an support@getloynara.com."
    : "Möchtest du doch weitermachen? Solange dein Programm läuft, kannst du die Kündigung unter Mehr › Geschäft › Programm beenden zurücknehmen.";
  const fact = (line: { label: string; value: string; sub: string }) => [`${line.label}: ${line.value}`, ...(line.sub ? [line.sub] : [])];
  return {
    subject: input.event.event === "received" ? `${shop}: Dein Programm endet am ${lines.lastDay.value}` : `${shop}: Neues Enddatum ${lines.lastDay.value}`,
    body: [
      "Hallo,", "",
      first,
      ...(facts.locations.length > 1 ? [`Gilt für alle deine Standorte: ${list(facts.locations.map(clean))} enden am selben Tag.`] : []),
      "", ...fact(lines.lastDay), "", ...fact(lines.lastInvoice), "", ...fact(lines.exportUntil), "",
      "Text für deine Kunden:", customerText(input.unit, endDate), "",
      "Wir schreiben deinen Kunden nichts. Auf ihrer Karte sehen sie das Enddatum ab jetzt. Hänge den Text an der Kasse aus oder schicke ihn selbst.", "",
      withdraw,
      ...footer,
    ].join("\n"),
  };
}

const germanDay = (iso: string) => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
function nextBilling(today: string, anchorDay: number) {
  for (let day = new Date(`${today}T00:00:00Z`); ; day = new Date(day.getTime() + 86_400_000)) {
    const iso = day.toISOString().slice(0, 10);
    if (iso === today) continue;
    const length = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
    if (day.getUTCDate() === Math.min(anchorDay, length)) return iso;
  }
}
