import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { deleteCardBirthday, getBirthday, getCardBirthday, queueBirthdayMessages, setCardBirthday, updateBirthday } from "./birthday";
import { closeCard } from "./card-lifecycle";
import { getCustomerExport } from "./export";
import { award, reverseEntry } from "./loyalty";
import { getMerchantMember } from "./merchant-members";
import { createMerchant, enroll, getCard, lookupCard } from "./product";
import { credentialHash } from "./wallet/data";
import { setWalletConsent } from "./wallet-messages";
import { BIRTHDAY_FIELD_TEXT, birthdayRule } from "./wallet-message-rules";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await pool.end(); });

const T = (iso: string) => new Date(iso);
/** Today's day and month in Berlin: the counter books "now", so the birthday is set to today for the booking tests. */
const berlinToday = () => { const [d, m] = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "numeric", month: "numeric" }).format(new Date()).split(".").map(Number); return { day: d, month: m }; };

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic owner", `${id}@example.test`]);
  return id;
}
async function shop(on: { bonus?: number } | null = {}) {
  const owner = await user();
  const m = await createMerchant({ userId: owner, businessName: "Café Kurz", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Karte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 10 });
  const s = { owner, slug: m.programSlug, programId: m.programId, locationId: m.locationId, tenantId: m.tenantId };
  if (on) await updateBirthday({ actorUserId: owner, programSlug: s.slug, settings: { enabled: true, bonus: 1, ...on } });
  return s;
}
type Shop = Awaited<ReturnType<typeof shop>>;
async function card(s: Shop, wallet: "consent" | "none" = "none") {
  const c = await enroll({ slug: s.slug, acceptedTerms: true });
  const { rows: [m] } = await pool.query("SELECT scan_code FROM memberships WHERE id = $1", [c.id]);
  if (wallet === "consent") {
    const passId = randomUUID();
    await pool.query("INSERT INTO wallet_passes (id, tenant_id, membership_id, provider, provider_object_id, credential_hash, status) VALUES ($1,$2,$3,'apple',$4,$5,'created')",
      [passId, s.tenantId, c.id, `passfast:${passId}`, credentialHash(m.scan_code)]);
    await setWalletConsent(c.cardToken, true);
  }
  return { ...c, scanCode: m.scan_code as string };
}
const give = (s: Shop, c: { id: string }) => award({ userId: s.owner, locationId: s.locationId, membershipId: c.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
const stored = async (c: { id: string }) => (await pool.query("SELECT day, month FROM card_birthdays WHERE membership_id = $1", [c.id])).rows;

describe("the birthday on the card", () => {
  it("is offered only while the bonus is on, with Legal's text, day and month only, and validated", async () => {
    const off = await shop(null); const a = await card(off);
    expect(await getCardBirthday(a.cardToken)).toMatchObject({ available: false });
    await expect(setCardBirthday(a.cardToken, { day: 1, month: 5 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const s = await shop(); const c = await card(s);
    expect(await getCardBirthday(c.cardToken)).toEqual({ available: true, day: null, month: null, text: BIRTHDAY_FIELD_TEXT("Café Kurz") });
    expect(BIRTHDAY_FIELD_TEXT("Café Kurz")).toBe("Geburtstag (freiwillig): nur Tag und Monat, kein Jahr. Damit kann dir Café Kurz in deiner Geburtstagswoche eine kleine Prämie geben. Du kannst ihn jederzeit hier löschen.");
    for (const bad of [{ day: 30, month: 2 }, { day: 31, month: 4 }, { day: 0, month: 1 }, { day: 1, month: 13 }]) await expect(setCardBirthday(c.cardToken, bad)).rejects.toMatchObject({ code: "INVALID_BIRTHDAY" });
    await setCardBirthday(c.cardToken, { day: 29, month: 2 });
    await setCardBirthday(c.cardToken, { day: 22, month: 10 });
    expect(await stored(c)).toEqual([{ day: 22, month: 10 }]);
    // The customer's own export carries it (Art. 15/20), and stops carrying it once deleted.
    expect((await getCustomerExport(c.cardToken)).birthday).toEqual({ day: 22, month: 10 });
    await deleteCardBirthday(c.cardToken);
    expect((await getCustomerExport(c.cardToken)).birthday).toBeNull();
  });

  it("is deleted completely on request, even after the owner switched the bonus off, and when the card is closed", async () => {
    const s = await shop(); const c = await card(s); const other = await card(s);
    await setCardBirthday(c.cardToken, { day: 3, month: 3 }); await setCardBirthday(other.cardToken, { day: 4, month: 4 });
    await updateBirthday({ actorUserId: s.owner, programSlug: s.slug, settings: { enabled: false, bonus: 1 } });
    expect(await getCardBirthday(c.cardToken)).toMatchObject({ available: true, day: 3, month: 3 });
    expect(await deleteCardBirthday(c.cardToken)).toEqual({ deleted: true });
    expect(await stored(c)).toEqual([]);
    await closeCard(other.cardToken);
    expect(await stored(other)).toEqual([]);
  });

  it("is never shown to the shop: counts only, nothing in the member view", async () => {
    const s = await shop(); const c = await card(s);
    await setCardBirthday(c.cardToken, { day: 7, month: 7 });
    expect(await getBirthday({ actorUserId: s.owner, programSlug: s.slug })).toEqual({ enabled: true, bonus: 1, bonusMax: 1, cards: 1 });
    expect(JSON.stringify(await getMerchantMember(s.owner, c.id))).not.toMatch(/"(day|month|birthday)"/);
    await expect(getBirthday({ actorUserId: await user(), programSlug: s.slug })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("birthday bonus at the counter", () => {
  it("books the bonus with a confirmed award in the birthday week, without any Wallet consent, once a year", async () => {
    const s = await shop(); const c = await card(s); const none = await card(s);
    await setCardBirthday(c.cardToken, berlinToday());
    expect((await lookupCard({ userId: s.owner, locationId: s.locationId, scanCode: c.scanCode })).birthdayBonus).toBe(1);
    const first = await give(s, c);
    expect(first).toMatchObject({ balance: 2, birthdayBonus: 1 });
    const { rows: [row] } = await pool.query("SELECT delta, reason, idempotency_key FROM ledger_entries WHERE membership_id = $1 AND source = 'birthday_bonus'", [c.id]);
    expect(row).toEqual({ delta: 1, reason: "Geburtstags-Bonus", idempotency_key: `birthday:${first.entryId}` });
    expect(await give(s, c)).toMatchObject({ birthdayBonus: 0, balance: 3 });
    // Moving the birthday does not earn a second bonus this year.
    const tomorrow = new Date(Date.now() + 86_400_000);
    await setCardBirthday(c.cardToken, { day: tomorrow.getUTCDate(), month: tomorrow.getUTCMonth() + 1 });
    expect(await give(s, c)).toMatchObject({ birthdayBonus: 0 });
    expect(await give(s, none)).toMatchObject({ birthdayBonus: 0 });
    expect((await getMerchantMember(s.owner, c.id)).member).toMatchObject({ qualifyingCheckouts: 3 });
    expect((await getCard(c.cardToken)).activity.filter(a => a.isBirthdayBonus)).toHaveLength(1);
  });

  it("is reversed with its award, never alone, and is then available again", async () => {
    const s = await shop(); const c = await card(s);
    await setCardBirthday(c.cardToken, berlinToday());
    const first = await give(s, c);
    const { rows: [bonus] } = await pool.query("SELECT id FROM ledger_entries WHERE membership_id = $1 AND source = 'birthday_bonus'", [c.id]);
    const reverse = (entryId: string) => reverseEntry({ userId: s.owner, locationId: s.locationId, entryId, reason: "Versehentlich gebucht", idempotencyKey: randomUUID(), requestId: randomUUID() });
    await expect(reverse(bonus.id)).rejects.toMatchObject({ code: "BIRTHDAY_BONUS_WITH_AWARD" });
    expect(await reverse(first.entryId)).toMatchObject({ balance: 0 });
    expect(await give(s, c)).toMatchObject({ birthdayBonus: 1, balance: 2 });
  });

  it("shows Legal's rules line while on, and books nothing with „kein Bonus“ or on production while hidden", async () => {
    const s = await shop(); const c = await card(s);
    expect((await getCard(c.cardToken)).rulesText).toBe(`Ein Stempel pro Kaffee.\n\n${birthdayRule("stamp", 1)}`);
    expect(birthdayRule("stamp", 1)).toBe("Geburtstags-Prämie: Hast du auf deiner Karte Tag und Monat deines Geburtstags hinterlegt, bekommst du in deiner Geburtstagswoche bei einem bestätigten Besuch 1 Stempel extra. Nicht auf Tabak, Presse, Bücher, Lotto und Handyguthaben.");
    const none = await shop({ bonus: 0 }); const n = await card(none);
    await setCardBirthday(n.cardToken, berlinToday());
    expect(await give(none, n)).toMatchObject({ birthdayBonus: 0 });
    await setCardBirthday(c.cardToken, berlinToday());
    vi.stubEnv("PRODUCTION_ENVIRONMENT", "loynara-production");
    expect(await give(s, c)).toMatchObject({ birthdayBonus: 0 });
    await expect(setCardBirthday(c.cardToken, { day: 1, month: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await deleteCardBirthday(c.cardToken)).toEqual({ deleted: true });
  });
});

describe("birthday reminder (Wallet)", () => {
  const MONDAY_10 = T("2026-10-26T09:00:00Z"); // Monday 26 Oct, 10:00 CET, the day after the clock change

  it("goes once in the birthday week, Mon–Sat 10–18, to consented holders, with the week's Sunday as the date", async () => {
    const s = await shop(); const c = await card(s, "consent"); const noConsent = await card(s); const lastWeek = await card(s, "consent");
    await setCardBirthday(c.cardToken, { day: 29, month: 10 }); await setCardBirthday(noConsent.cardToken, { day: 29, month: 10 }); await setCardBirthday(lastWeek.cardToken, { day: 25, month: 10 });
    expect(await queueBirthdayMessages(T("2026-10-26T08:30:00Z"))).toBe(0); // 09:30 CET
    expect(await queueBirthdayMessages(MONDAY_10)).toBe(1);
    expect(await queueBirthdayMessages(T("2026-10-27T09:00:00Z"))).toBe(0);
    const { rows } = await pool.query("SELECT w.text, r.membership_id FROM wallet_messages w JOIN wallet_message_recipients r ON r.message_id = w.id WHERE w.kind = 'birthday'");
    expect(rows).toEqual([{ text: "Alles Gute zum Geburtstag! Komm bis zum 1. November vorbei, dann gibt's einen Stempel extra.", membership_id: c.id }]);
  });

  it("uses the no-bonus text with „kein Bonus“ and is withheld on production", async () => {
    const s = await shop({ bonus: 0 }); const c = await card(s, "consent");
    await setCardBirthday(c.cardToken, { day: 26, month: 10 });
    vi.stubEnv("PRODUCTION_ENVIRONMENT", "loynara-production");
    expect(await queueBirthdayMessages(MONDAY_10)).toBe(0);
    vi.unstubAllEnvs();
    expect(await queueBirthdayMessages(MONDAY_10)).toBe(1);
    expect((await pool.query("SELECT text FROM wallet_messages WHERE kind = 'birthday'")).rows[0].text).toBe("Alles Gute zum Geburtstag! Wir freuen uns, dich bald wiederzusehen.");
  });
});
