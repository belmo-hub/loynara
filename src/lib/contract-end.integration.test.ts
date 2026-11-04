import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { outboxJobs, subscriptions } from "@/db/schema";
import { setStripeClient } from "./billing-stripe";
import { contractFacts, factsLines } from "./contract-end";
import { contractEndEmailText, deliverContractEndEmail } from "./contract-end-email";
import { operatorCancellations, ownerContractView } from "./contract-end-view";
import { createAdditionalLocation } from "./locations";
import { createMerchant } from "./product";
import { requestCancellation } from "./programme-end";
import type { TransactionalEmailProvider, TransactionalMessage } from "./transactional-email";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");

// Synthetic Stripe settings (no request leaves the process: the fake below answers the one call, GET /account).
const STRIPE_ENV = { LIVE_BILLING_ENABLED: "true", STRIPE_SECRET_KEY: `sk_test_${"k".repeat(24)}`, STRIPE_WEBHOOK_SECRET: `whsec_${"s".repeat(32)}`, STRIPE_PRICE_FOUNDING: "price_founding0001", STRIPE_PRICE_LIST: "price_list00000001",
  SMTP_HOST: "localhost", PUBLIC_BASE_URL: "http://localhost:3000", EXTERNAL_EMAIL_ENABLED: "false", BILLING_VAT_MODE: undefined, SHOP_ERASURE_DELAY_DAYS: undefined, PRODUCTION_ENVIRONMENT: undefined,
  OPERATOR_NAME: "Synthetische Betreiberin", OPERATOR_ADDRESS: "Musterstraße 1\n12345 Musterstadt" };
const saved: Record<string, string | undefined> = {};
let account: unknown;
beforeEach(async () => {
  await pool.query('TRUNCATE TABLE tenants, "user", rate_limits CASCADE');
  for (const [name, value] of Object.entries(STRIPE_ENV)) { if (!(name in saved)) saved[name] = process.env[name]; if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  account = { business_profile: { name: "Synthetische Betreiberin", support_address: { line1: "Musterstraße 1", line2: null, postal_code: "12345", city: "Musterstadt" } } };
  setStripeClient(async (method, path) => { if (method === "GET" && path === "/account") return account; throw new Error(`Unexpected Stripe call ${method} ${path}`); });
});
afterEach(() => { setStripeClient(); for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
afterAll(async () => { await pool.end(); });

const plain = (text: string) => text.replace(/ /g, " ");
const location = (name: string) => ({ name, city: "Kassel", country: "DE" as const, timezone: "Europe/Berlin", programName: `Karte ${name}`, programType: "stamp" as const, rulesText: "Ein Stempel pro bestätigtem Kassenvorgang.", rewardTitle: "Kaffee", rewardCost: 5 });

/** The spec's sample shops: Café Lindenblatt (go-live 28.08.2026, free until 27.09., 49 € a month) and Barbier Nord (go-live 20.10.2026). */
async function shop(goLive: string, freeUntil: string, { name = "Café Lindenblatt", second = false, type = "stamp" as "stamp" | "points" } = {}) {
  const ownerId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [ownerId, "Synthetische Inhaberin", `${ownerId}@example.test`]);
  const created = await createMerchant({ userId: ownerId, businessName: name, locationName: "Kassel Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Karte", programType: type, rulesText: "Ein Stempel pro bestätigtem Kassenvorgang.", rewardTitle: "Kaffee", rewardCost: 5 });
  if (second) await createAdditionalLocation(ownerId, location("Kassel Nord"));
  await db.update(subscriptions).set({ status: "active", provider: "stripe", providerSubscriptionId: `sub_test${randomUUID().slice(0, 8)}`, planCode: "list", priceMinor: 4900, activeLocationCount: second ? 2 : 1,
    startedAt: new Date(`${goLive}T08:00:00Z`), freeUntil: new Date(`${freeUntil}T00:00:00Z`) }).where(eq(subscriptions.tenantId, created.tenantId));
  return { ...created, ownerId };
}
const at = (iso: string) => new Date(iso);
const lines = async (tenantId: string, endDate: string, now: string, requestDay?: string) => {
  const facts = (await contractFacts(tenantId, endDate, at(now), requestDay))!;
  const text = factsLines(facts, "kleinunternehmer");
  return { facts, text: { lastDay: text.lastDay.value, invoice: plain(text.lastInvoice.value), invoiceSub: plain(text.lastInvoice.sub), exportUntil: text.exportUntil.value, exportSub: text.exportUntil.sub } };
};

describe("the three facts (ENG-167, one function for screens and emails)", () => {
  it("end of the current billing month: no further invoice, naming the last one (C2, C3)", async () => {
    const s = await shop("2026-08-28", "2026-09-28");
    expect((await lines(s.tenantId, "2026-11-27", "2026-11-01T10:00:00Z")).text).toEqual({
      lastDay: "27.11.2026", invoice: "Keine weitere Rechnung", invoiceSub: "Die letzte kam am 28.10.2026: 49 € für 28.10.–27.11.2026.",
      exportUntil: "27.12.2026", exportSub: "Danach löschen wir alle Daten deines Geschäfts und deiner Kunden. Rechnungen und Vertragsunterlagen bewahren wir auf, solange das Gesetz es verlangt." });
  });

  it("one or several invoices still to come (C5, C6), totals for several locations (C4)", async () => {
    const s = await shop("2026-08-28", "2026-09-28");
    expect((await lines(s.tenantId, "2026-12-27", "2026-11-18T10:00:00Z")).text).toMatchObject({ invoice: "28.11.2026 · 49 €", invoiceSub: "Für 28.11.–27.12.2026. Das ist die letzte Rechnung." });
    expect((await lines(s.tenantId, "2027-01-27", "2026-11-18T10:00:00Z")).text).toMatchObject({ invoice: "28.12.2026 · 49 €", invoiceSub: "Noch 2 Rechnungen: 28.11. und 28.12.2026, je 49 €. Die am 28.12. ist die letzte." });
    const two = await shop("2026-08-28", "2026-09-28", { name: "Café Zwei", second: true });
    expect((await lines(two.tenantId, "2026-11-27", "2026-11-01T10:00:00Z")).text.invoiceSub).toBe("Die letzte kam am 28.10.2026: 98 € (2 Standorte) für 28.10.–27.11.2026.");
    expect((await contractFacts(two.tenantId, "2026-11-27", at("2026-11-01T10:00:00Z")))!.locations).toEqual(["Kassel Mitte", "Kassel Nord"]);
    // C2/C5 show the plain total; the location count belongs to C4 only.
    expect((await lines(two.tenantId, "2026-12-27", "2026-11-18T10:00:00Z")).text).toMatchObject({ invoice: "28.11.2026 · 98 €", invoiceSub: "Für 28.11.–27.12.2026. Das ist die letzte Rechnung." });
  });

  it("the free month costs nothing (C7), and the days after it up to request + 14 neither (C38)", async () => {
    const s = await shop("2026-10-20", "2026-11-20", { name: "Barbier Nord", type: "points" });
    expect((await lines(s.tenantId, "2026-11-19", "2026-11-01T10:00:00Z", "2026-11-01")).text).toMatchObject({ invoice: "Keine Rechnung", invoiceSub: "Dein erster Monat ist kostenlos. Hörst du im ersten Monat auf, kostet es nichts." });
    expect((await lines(s.tenantId, "2026-11-26", "2026-11-12T10:00:00Z", "2026-11-12")).text).toMatchObject({ invoice: "Keine Rechnung", invoiceSub: "Dein erster Monat ist kostenlos, die Tage danach bis einschließlich 26.11.2026 auch." });
    // A later end the shop agreed to is billed: the month that opens on 20.11. has its invoice.
    expect((await lines(s.tenantId, "2026-12-19", "2026-11-12T10:00:00Z", "2026-11-12")).text).toMatchObject({ invoice: "20.11.2026 · 49 €" });
  });

  it("names the DS-05 period only once it is set (Legal: never a placeholder)", async () => {
    const s = await shop("2026-08-28", "2026-09-28");
    const facts = (await contractFacts(s.tenantId, "2026-11-27", at("2026-11-01T10:00:00Z")))!;
    expect(factsLines(facts, "kleinunternehmer", {}).exportUntil.sub).not.toMatch(/innerhalb|DS-05|\{/);
    expect(factsLines(facts, "kleinunternehmer", { SHOP_ERASURE_DELAY_DAYS: "14" }).exportUntil.sub).toBe("Danach löschen wir innerhalb von 14 Tagen alle Daten deines Geschäfts und deiner Kunden. Rechnungen und Vertragsunterlagen bewahren wir auf, solange das Gesetz es verlangt.");
    expect(plain(factsLines(facts, "standard", {}).lastInvoice.sub)).toContain("49 € zzgl. USt");
  });
});

describe("the owner's emails (M1–M3, Marketing FINAL with Legal's conditions)", () => {
  const OPERATOR = { name: "Synthetische Betreiberin", address: "Musterstraße 1, 12345 Musterstadt" };
  const footer = ["", "Viele Grüße", "Loynara", "", "Synthetische Betreiberin · Musterstraße 1, 12345 Musterstadt"];

  it("M1 at the cancellation: when it arrived (Berlin), the three facts, the customer text and card line, the in-app withdrawal, the operator", async () => {
    const s = await shop("2026-08-28", "2026-09-28");
    const text = (await contractEndEmailText({ tenantId: s.tenantId, shop: "Café Lindenblatt", unit: "Stempel", operator: OPERATOR, now: at("2026-11-01T09:15:00Z"),
      event: { event: "received", endDate: "2026-11-27", receivedAt: "2026-11-01T09:15:00.000Z", requestDay: "2026-11-01" }, env: {} }))!;
    expect(text.subject).toBe("Café Lindenblatt: Dein Programm endet am 27.11.2026");
    expect(plain(text.body)).toBe([
      "Hallo,", "",
      "wir haben deine Kündigung am 01.11.2026 um 10:15 Uhr erhalten. Dein Programm endet am 27.11.2026. Das gilt jetzt:", "",
      "Letzter Tag: 27.11.2026", "Bis dahin läuft alles normal: Deine Kunden sammeln weiter und lösen Prämien ein.", "",
      "Letzte Rechnung: Keine weitere Rechnung", "Die letzte kam am 28.10.2026: 49 € für 28.10.–27.11.2026.", "",
      "Daten herunterladen bis: 27.12.2026", "Danach löschen wir alle Daten deines Geschäfts und deiner Kunden. Rechnungen und Vertragsunterlagen bewahren wir auf, solange das Gesetz es verlangt.", "",
      "Text für deine Kunden:", "Unsere Stempelkarte läuft noch bis einschließlich 27.11.2026. Bis dahin kannst du weiter sammeln und Prämien einlösen. Danach geht das nicht mehr.", "",
      "Wir schreiben deinen Kunden nichts. Auf ihrer Karte sehen sie das Enddatum ab jetzt. Hänge den Text an der Kasse aus oder schicke ihn selbst.", "",
      "Möchtest du doch weitermachen? Solange dein Programm läuft, kannst du die Kündigung unter Mehr › Geschäft › Programm beenden zurücknehmen.",
      ...footer,
    ].join("\n"));
  });

  it("M1 names every location, and with the cancellation surface off points to support for a withdrawal", async () => {
    const s = await shop("2026-08-28", "2026-09-28", { second: true });
    const text = (await contractEndEmailText({ tenantId: s.tenantId, shop: "Café Lindenblatt", unit: "Stempel", operator: OPERATOR, now: at("2026-11-01T09:15:00Z"),
      event: { event: "received", endDate: "2026-11-27", receivedAt: "2026-11-01T09:15:00.000Z", requestDay: "2026-11-01" }, env: { PRODUCTION_ENVIRONMENT: "loynara-production" } }))!;
    expect(text.body).toContain("Das gilt jetzt:\nGilt für alle deine Standorte: Kassel Mitte und Kassel Nord enden am selben Tag.");
    expect(text.body).toContain("Möchtest du doch weitermachen? Solange dein Programm läuft, kannst du die Kündigung zurücknehmen. Schreibe uns dazu an support@getloynara.com.");
    expect(text.body).not.toContain("Mehr › Geschäft");
  });

  it("M2 for a later end, M3 for a withdrawal: next invoice when paid, the first billing date in the free month", async () => {
    const s = await shop("2026-08-28", "2026-09-28");
    const changed = (await contractEndEmailText({ tenantId: s.tenantId, shop: "Café Lindenblatt", unit: "Stempel", operator: OPERATOR, now: at("2026-11-18T09:00:00Z"), event: { event: "changed", endDate: "2026-12-27", receivedAt: null, requestDay: null }, env: {} }))!;
    expect(changed.subject).toBe("Café Lindenblatt: Neues Enddatum 27.12.2026");
    expect(plain(changed.body)).toContain("dein Enddatum hat sich geändert. Das gilt jetzt:\n\nLetzter Tag: 27.12.2026");
    const withdrawn = (await contractEndEmailText({ tenantId: s.tenantId, shop: "Café Lindenblatt", unit: "Stempel", operator: OPERATOR, now: at("2026-11-18T09:00:00Z"), event: { event: "withdrawn", endDate: null, receivedAt: null, requestDay: null }, env: {} }))!;
    expect(withdrawn.subject).toBe("Café Lindenblatt: Dein Programm läuft weiter");
    expect(plain(withdrawn.body)).toBe(["Hallo,", "", "deine Kündigung ist zurückgenommen. Dein Programm läuft ohne Enddatum weiter.", "", "Die Abrechnung bleibt wie bisher: nächste Rechnung am 28.11.2026, 49 €.", ...footer].join("\n"));
    const free = await shop("2026-10-20", "2026-11-20", { name: "Barbier Nord" });
    const freeWithdrawn = (await contractEndEmailText({ tenantId: free.tenantId, shop: "Barbier Nord", unit: "Punkte", operator: OPERATOR, now: at("2026-11-05T09:00:00Z"), event: { event: "withdrawn", endDate: null, receivedAt: null, requestDay: null }, env: {} }))!;
    expect(plain(freeWithdrawn.body)).toContain("Nach dem kostenlosen Monat beginnt die Abrechnung am 20.11.2026, 49 € im Monat.");
  });

  it("queues M1 with the cancellation and sends it once, with live billing off too; it waits an hour and tries again without the operator's settings or with email off", async () => {
    const s = await shop("2026-08-28", "2026-09-28");
    const [{ slug }] = (await pool.query("SELECT slug FROM programs WHERE tenant_id = $1", [s.tenantId])).rows;
    await requestCancellation({ actorUserId: s.ownerId, programSlug: slug, now: at("2026-11-01T09:15:00Z") });
    const [job] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.contract_end"));
    const sent: TransactionalMessage[] = [];
    const provider: TransactionalEmailProvider = { name: "mailpit", async send(message) { sent.push(message); return { state: "accepted", messageId: `local:${message.jobId}` }; } };
    process.env.SMTP_HOST = "disabled";
    // M1 is the text-form confirmation: it is never dropped, only tried again an hour later (review N-3).
    expect(await deliverContractEndEmail(job, provider, at("2026-11-01T09:16:00Z"))).toEqual({ status: "deferred", reason: "Transactional email unavailable", until: at("2026-11-01T10:16:00Z") });
    process.env.SMTP_HOST = "localhost";
    delete process.env.OPERATOR_ADDRESS;
    expect(await deliverContractEndEmail(job, provider, at("2026-11-01T09:16:00Z"))).toMatchObject({ status: "deferred", reason: expect.stringContaining("OPERATOR_ADDRESS"), until: at("2026-11-01T10:16:00Z") });
    process.env.OPERATOR_ADDRESS = "Musterstraße 1\n12345 Musterstadt";
    // The confirmation never waits on live billing (CTO): Stripe is off and isn't asked.
    process.env.LIVE_BILLING_ENABLED = "false";
    for (const name of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_FOUNDING", "STRIPE_PRICE_LIST"]) delete process.env[name];
    setStripeClient(async () => { throw new Error("Stripe must not be called for an owner email"); });
    expect(await deliverContractEndEmail(job, provider, at("2026-11-01T09:16:00Z"))).toEqual({ status: "complete" });
    expect(await deliverContractEndEmail(job, provider, at("2026-11-01T09:17:00Z"))).toMatchObject({ status: "blocked" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: expect.stringMatching(/@example\.test$/), subject: "Café Lindenblatt: Dein Programm endet am 27.11.2026" });
    expect(sent[0].body).toContain("am 01.11.2026 um 10:15 Uhr erhalten");
    expect(sent[0].body.endsWith("Synthetische Betreiberin · Musterstraße 1, 12345 Musterstadt")).toBe(true);
  });
});

describe("the owner's „Programm beenden“ view (ENG-167 b)", () => {
  const view = async (s: { ownerId: string; tenantId: string }, now: string) => {
    const [{ slug }] = (await pool.query("SELECT slug FROM programs WHERE tenant_id = $1 ORDER BY created_at LIMIT 1", [s.tenantId])).rows;
    return ownerContractView({ actorUserId: s.ownerId, programSlug: slug, now: at(now), env: {} });
  };

  it("O1 before cancelling: the earliest end and its facts, no reason line; O2 late notice names the missed end and its cutoff", async () => {
    const s = await shop("2026-08-28", "2026-09-28");
    expect(await view(s, "2026-11-01T10:00:00Z")).toMatchObject({ state: "open", endDateText: "27.11.2026", reason: null, locations: null, facts: { lastInvoice: { value: "Keine weitere Rechnung" } } });
    expect(await view(s, "2026-11-18T10:00:00Z")).toMatchObject({ state: "open", endDateText: "27.12.2026",
      reason: "Du kannst mit 14 Tagen Frist zum letzten Tag eines Abrechnungsmonats kündigen. Für ein Ende am 27.11.2026 hätte die Kündigung bis zum 13.11.2026 bei uns sein müssen. Darum endet dein Vertrag am 27.12.2026." });
  });

  it("O3 / O3b in the free month: free, ending on the last free day or request + 14 (C11)", async () => {
    const s = await shop("2026-10-20", "2026-11-20", { name: "Barbier Nord", type: "points" });
    expect(await view(s, "2026-11-01T10:00:00Z")).toMatchObject({ endDateText: "19.11.2026", unit: "Punkte", facts: { lastInvoice: { value: "Keine Rechnung" } },
      reason: "Du bist im kostenlosen ersten Monat. Kündigst du jetzt, kostet dich das nichts. Dein Programm läuft noch bis einschließlich 19.11.2026, damit deine Kunden das Ende mindestens 14 Tage vorher auf ihrer Karte sehen." });
    expect(await view(s, "2026-11-12T10:00:00Z")).toMatchObject({ endDateText: "26.11.2026", reason: expect.stringContaining("bis einschließlich 26.11.2026") });
  });

  it("O4 after the cancellation: the recorded end, when it came in, the customer text; O5 when a later end was agreed; the withdrawal text", async () => {
    const s = await shop("2026-08-28", "2026-09-28", { second: true });
    const [{ slug }] = (await pool.query("SELECT slug FROM programs WHERE tenant_id = $1 ORDER BY created_at LIMIT 1", [s.tenantId])).rows;
    await requestCancellation({ actorUserId: s.ownerId, programSlug: slug, now: at("2026-11-01T10:00:00Z") });
    expect(await view(s, "2026-11-03T10:00:00Z")).toMatchObject({ state: "cancelled", requestedOn: "01.11.2026", endDateText: "27.11.2026", reason: null,
      locations: "Gilt für alle deine Standorte: Kassel Mitte und Kassel Nord enden am selben Tag.",
      customerText: "Unsere Stempelkarte läuft noch bis einschließlich 27.11.2026. Bis dahin kannst du weiter sammeln und Prämien einlösen. Danach geht das nicht mehr.",
      withdrawal: { text: "Dein Programm läuft dann ohne Enddatum weiter. Die Abrechnung bleibt wie bisher: nächste Rechnung am 28.11.2026, 98\u00a0€." } });
    await pool.query("UPDATE programs SET cancellation_end_date = '2026-12-27' WHERE tenant_id = $1", [s.tenantId]);
    expect(await view(s, "2026-11-03T10:00:00Z")).toMatchObject({ state: "later", endDateText: "27.12.2026", facts: { lastInvoice: { value: "28.11.2026 · 98\u00a0€" } } });
  });

  it("an end the operator set without a request is shown as agreed, with its facts, never as open (Design blocking 6)", async () => {
    const s = await shop("2026-08-28", "2026-09-28");
    await pool.query("UPDATE programs SET cancellation_end_date = '2026-12-27', cancellation_confirmed_at = now() WHERE tenant_id = $1", [s.tenantId]);
    expect(await view(s, "2026-11-03T10:00:00Z")).toMatchObject({ state: "planned", endDateText: "27.12.2026", requestedOn: null, reason: null, facts: { lastDay: { value: "27.12.2026" } } });
  });

  it("answers only the shop's owner, like a missing programme otherwise", async () => {
    const s = await shop("2026-08-28", "2026-09-28");
    const [{ slug }] = (await pool.query("SELECT slug FROM programs WHERE tenant_id = $1", [s.tenantId])).rows;
    await expect(ownerContractView({ actorUserId: randomUUID(), programSlug: slug })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("the operator's „Kündigungen“ (ENG-167 b)", () => {
  const cancel = async (s: { ownerId: string; tenantId: string }, now: string) => {
    const [{ slug }] = (await pool.query("SELECT slug FROM programs WHERE tenant_id = $1 ORDER BY created_at LIMIT 1", [s.tenantId])).rows;
    await requestCancellation({ actorUserId: s.ownerId, programSlug: slug, now: at(now) });
  };
  const plainAll = (value: unknown) => JSON.parse(plain(JSON.stringify(value)));

  it("one row per business: facts line, badges, the binding date first and later ends only with consent (C24–C42)", async () => {
    const s = await shop("2026-08-28", "2026-09-28", { second: true });
    await cancel(s, "2026-11-01T10:00:00Z");
    const [entry] = plainAll(await operatorCancellations(at("2026-11-03T10:00:00Z"), {}));
    expect(entry).toMatchObject({ tenant: "Café Lindenblatt", locations: ["Kassel Mitte", "Kassel Nord"], badge: "gekündigt zum 27.11.2026", deadline: "bestätigen bis 26.11.2026", acknowledged: false,
      factsLine: "vor 2 Tagen angefragt · Abrechnung am 28. · keine weitere Rechnung · Export bis 27.12.2026" });
    expect(entry.choices.map((choice: { label: string; consent: boolean }) => [choice.label, choice.consent])).toEqual([
      ["27.11.2026 · Wie gekündigt · keine weitere Rechnung", false],
      ["27.12.2026 · Eine Rechnung mehr: 28.11.2026, 98 €", true],
      ["27.01.2027 · Zwei Rechnungen mehr: 28.11.2026 und 28.12.2026, je 98 €", true],
      ["27.02.2027 · Drei Rechnungen mehr: 28.11.2026, 28.12.2026 und 28.01.2027, je 98 €", true],
    ]);
    expect(entry.withdrawal).toBe("Das Programm von Café Lindenblatt läuft dann ohne Enddatum weiter. Die Abrechnung bleibt: nächste Rechnung am 28.11.2026, 98 €. Das Geschäft bekommt eine E-Mail.");
  });

  it("in the free month: the one binding date, no deadline badge; C31 only on the last free day, C42 at request + 14 (Design blocking 8)", async () => {
    const s = await shop("2026-10-20", "2026-11-20", { name: "Barbier Nord" });
    await cancel(s, "2026-11-12T10:00:00Z");
    const [late] = plainAll(await operatorCancellations(at("2026-11-12T12:00:00Z"), {}));
    expect(late).toMatchObject({ freeMonth: true, deadline: null, badge: "gekündigt zum 26.11.2026" });
    expect(late.choices.map((choice: { label: string }) => choice.label)).toEqual(["26.11.2026 · Wie gekündigt · keine Rechnung"]);
    const early = await shop("2026-10-21", "2026-11-20", { name: "Barbier Süd" });
    await cancel(early, "2026-11-01T10:00:00Z");
    const entries = plainAll(await operatorCancellations(at("2026-11-01T12:00:00Z"), {}));
    expect(entries.find((entry: { tenant: string }) => entry.tenant === "Barbier Süd").choices.map((choice: { label: string }) => choice.label)).toEqual(["19.11.2026 · Ende des kostenlosen Monats · keine Rechnung"]);
  });

  it("C41 „Stripe-Abo beendet“ only once Stripe holds the end; until then a danger flag, so a failed cancel shows (Design should-fix)", async () => {
    const s = await shop("2026-10-20", "2026-11-20", { name: "Barbier Nord" });
    await cancel(s, "2026-11-12T10:00:00Z");
    const [failed] = plainAll(await operatorCancellations(at("2026-11-12T12:00:00Z"), {}));
    expect(failed).toMatchObject({ stripeNotEnded: true, factsLine: "heute angefragt · kostenloser Monat · keine Rechnung · Export bis 26.12.2026" });
    await pool.query("UPDATE subscriptions SET billing_ends_at = '2026-11-19T20:00:00Z' WHERE tenant_id = $1", [s.tenantId]);
    const [held] = plainAll(await operatorCancellations(at("2026-11-12T12:00:00Z"), {}));
    expect(held).toMatchObject({ stripeNotEnded: false, factsLine: "heute angefragt · kostenloser Monat · keine Rechnung · Stripe-Abo beendet · Export bis 26.12.2026" });
  });

  it("after an agreed later end: „Wie bisher“ without consent first, then later ends with consent, nothing earlier (Design blocking 3)", async () => {
    const s = await shop("2026-08-28", "2026-09-28");
    await cancel(s, "2026-11-01T10:00:00Z");
    await pool.query("UPDATE programs SET cancellation_end_date = '2026-12-27' WHERE tenant_id = $1", [s.tenantId]);
    await pool.query("INSERT INTO programme_cancellation_events (tenant_id, program_id, action, actor_user_id, old_end_date, new_end_date) SELECT tenant_id, id, 'schedule', 'synthetic-operator', '2026-11-27', '2026-12-27' FROM programs WHERE tenant_id = $1", [s.tenantId]);
    const [entry] = plainAll(await operatorCancellations(at("2026-11-03T10:00:00Z"), {}));
    expect(entry.choices.map((choice: { label: string; consent: boolean; endDate: string }) => [choice.endDate, choice.label, choice.consent])).toEqual([
      ["2026-12-27", "27.12.2026 · Wie bisher · 28.11.2026 · 49 €", false],
      ["2027-01-27", "27.01.2027 · Eine Rechnung mehr: 28.12.2026, 49 €", true],
      ["2027-02-27", "27.02.2027 · Zwei Rechnungen mehr: 28.12.2026 und 28.01.2027, je 49 €", true],
      ["2027-03-27", "27.03.2027 · Drei Rechnungen mehr: 28.12.2026, 28.01.2027 und 28.02.2027, je 49 €", true],
    ]);
  });

  it("an unbilled shop (live billing off) owes nothing for a later end: „keine Rechnung“, never „0 Rechnungen mehr“ (Design blocking 4)", async () => {
    const s = await shop("2026-08-28", "2026-09-28");
    await pool.query("UPDATE subscriptions SET free_until = NULL, provider_subscription_id = NULL, provider = 'none' WHERE tenant_id = $1", [s.tenantId]);
    await cancel(s, "2026-11-01T10:00:00Z");
    const [entry] = plainAll(await operatorCancellations(at("2026-11-03T10:00:00Z"), {}));
    expect(entry.choices).toHaveLength(4);
    for (const choice of entry.choices.slice(1)) expect(choice.label).toMatch(/^\d\d\.\d\d\.\d{4} · keine Rechnung$/);
    expect(JSON.stringify(entry.choices)).not.toContain("0 Rechnungen");
  });
});
