import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool } from "@/db";
import { award, reverseEntry, winbackState } from "./loyalty";
import { getMerchantMember } from "./merchant-members";
import { createMerchant, enroll, getCard, getPublicProgram, lookupCard, updateProgram } from "./product";
import { credentialHash } from "./wallet/data";
import { deliverWalletMessage, setWalletConsent, type WalletMessageSend } from "./wallet-messages";
import { winbackRule } from "./wallet-message-rules";
import { getWinback, queueWinbackMessages, updateWinback } from "./winback";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await pool.end(); });

const T = (iso: string) => new Date(iso);

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic owner", `${id}@example.test`]);
  return id;
}
async function shop(type: "stamp" | "points" = "stamp", winback: { enabled?: boolean; days?: number; bonus?: number } | null = {}) {
  const owner = await user();
  const m = await createMerchant({ userId: owner, businessName: "Synthetic Barber", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Karte", programType: type, rulesText: "Ein Stempel pro Besuch.", rewardTitle: "Gratis", rewardCost: type === "stamp" ? 10 : 100 });
  const s = { owner, slug: m.programSlug, programId: m.programId, locationId: m.locationId, tenantId: m.tenantId };
  if (winback) await updateWinback({ actorUserId: owner, programSlug: s.slug, settings: { enabled: true, days: 30, bonus: 1, ...winback } });
  return s;
}
type Shop = Awaited<ReturnType<typeof shop>>;
/** A card, optionally holding a live Apple pass with message consent. */
async function card(s: Shop, wallet: "consent" | "pass" | "none" = "consent") {
  const c = await enroll({ slug: s.slug, acceptedTerms: true });
  const { rows: [m] } = await pool.query("SELECT scan_code FROM memberships WHERE id = $1", [c.id]);
  const passId = randomUUID();
  if (wallet !== "none") await pool.query("INSERT INTO wallet_passes (id, tenant_id, membership_id, provider, provider_object_id, credential_hash, status) VALUES ($1,$2,$3,'apple',$4,$5,'created')",
    [passId, s.tenantId, c.id, `passfast:${passId}`, credentialHash(m.scan_code)]);
  if (wallet === "consent") await setWalletConsent(c.cardToken, true);
  return { ...c, passId, scanCode: m.scan_code as string };
}
type Card = Awaited<ReturnType<typeof card>>;
/** A confirmed stamp booked in the past (the ledger is append-only, so it is inserted with its time). */
async function stampAt(s: Shop, c: Card, at: Date | string) {
  const { rows: [e] } = await pool.query(`INSERT INTO ledger_entries (tenant_id, location_id, membership_id, delta, kind, source, actor_user_id, request_id, idempotency_key, created_at)
    VALUES ($1,$2,$3,1,'award','staff_online',$4,$5,$6,${typeof at === "string" ? at : "$7"}) RETURNING id`,
    [s.tenantId, s.locationId, c.id, s.owner, randomUUID(), randomUUID(), ...(typeof at === "string" ? [] : [at])]);
  await pool.query("UPDATE memberships SET balance = balance + 1 WHERE id = $1", [c.id]);
  return e.id as string;
}
/** Noon (Berlin) of the Berlin calendar day `n` days before today: what the counter sees "today" is then day n. */
const berlinDaysAgo = (n: number) => `((now() AT TIME ZONE 'Europe/Berlin')::date - ${n} + time '12:00') AT TIME ZONE 'Europe/Berlin'`;
const give = (s: Shop, c: Card, key = randomUUID()) => award({ userId: s.owner, locationId: s.locationId, membershipId: c.id, quantity: 1, idempotencyKey: key, requestId: randomUUID() });
const ledger = async (c: Card) => (await pool.query("SELECT id, source, kind, delta, reason, idempotency_key, reversal_of_id FROM ledger_entries WHERE membership_id = $1 ORDER BY created_at, kind", [c.id])).rows;
const winbackMessages = async (s: Shop) => (await pool.query(`SELECT w.text, w.audience_count AS audience, array_agg(r.membership_id::text ORDER BY r.membership_id) AS members
  FROM wallet_messages w JOIN wallet_message_recipients r ON r.message_id = w.id WHERE w.tenant_id = $1 AND w.kind = 'winback' GROUP BY w.id ORDER BY w.created_at, w.text`, [s.tenantId])).rows;

describe("win-back bonus at the counter", () => {
  it("books the bonus from day N to day N + 14 after the last confirmed stamp, not a day before or after", async () => {
    const s = await shop();
    for (const [days, expected] of [[29, 0], [30, 1], [44, 1], [45, 0]] as const) {
      const c = await card(s, "none");
      await stampAt(s, c, berlinDaysAgo(days));
      expect((await lookupCard({ userId: s.owner, locationId: s.locationId, scanCode: c.scanCode })).winbackBonus, `day ${days}`).toBe(expected);
      expect(await give(s, c), `day ${days}`).toMatchObject({ balance: 2 + expected, creditedQuantity: 1, winbackBonus: expected });
    }
  });

  it("is not booked with an offline-synced award: its visit day is not known to the server (as happy hour)", async () => {
    const s = await shop(); const c = await card(s, "none");
    await stampAt(s, c, berlinDaysAgo(31));
    expect(await award({ userId: s.owner, locationId: s.locationId, membershipId: c.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID(), source: "staff_offline" })).toMatchObject({ winbackBonus: 0, balance: 2 });
  });

  it("applies to every returning card, with or without message consent or a Wallet pass (Art. 7 (4) DSGVO)", async () => {
    const s = await shop();
    for (const wallet of ["none", "pass", "consent"] as const) {
      const c = await card(s, wallet);
      await stampAt(s, c, berlinDaysAgo(31));
      expect(await give(s, c)).toMatchObject({ winbackBonus: 1 });
    }
  });

  it("is a labelled row keyed by its award, once per lapse, never on a replay, and never a visit", async () => {
    const s = await shop(); const c = await card(s);
    await stampAt(s, c, berlinDaysAgo(40));
    const key = randomUUID();
    const first = await give(s, c, key);
    const bonus = (await ledger(c)).find(row => row.source === "winback_bonus");
    expect(bonus).toMatchObject({ kind: "award", delta: 1, reason: "Willkommen-zurück-Bonus", idempotency_key: `winback:${first.entryId}` });
    expect(await give(s, c, key)).toMatchObject({ duplicate: true, balance: 3 });
    // The card's last stamp is now today: the next award is outside the window.
    expect(await give(s, c)).toMatchObject({ winbackBonus: 0, balance: 4 });
    expect((await ledger(c)).filter(row => row.source === "winback_bonus")).toHaveLength(1);
    expect((await getMerchantMember(s.owner, c.id)).member).toMatchObject({ qualifyingCheckouts: 3 });
    expect((await getCard(c.cardToken)).activity.filter(a => a.isWinbackBonus).map(a => a.delta)).toEqual([1]);
  });

  it("is reversed with its award, cannot be reversed alone, and a reversed award does not end the lapse", async () => {
    const s = await shop(); const c = await card(s);
    await stampAt(s, c, berlinDaysAgo(35));
    const first = await give(s, c);
    const bonus = (await ledger(c)).find(row => row.source === "winback_bonus");
    const reverse = (entryId: string) => reverseEntry({ userId: s.owner, locationId: s.locationId, entryId, reason: "Versehentlich gebucht", idempotencyKey: randomUUID(), requestId: randomUUID() });
    await expect(reverse(bonus.id)).rejects.toMatchObject({ code: "WINBACK_BONUS_WITH_AWARD" });
    expect(await reverse(first.entryId)).toMatchObject({ balance: 1 });
    expect((await ledger(c)).find(row => row.reversal_of_id === bonus.id)).toMatchObject({ delta: -1, idempotency_key: `winback-reversal:${first.entryId}` });
    // The corrected award no longer counts as the last stamp: the card is still in its window and the next award gets the bonus.
    expect(await give(s, c)).toMatchObject({ winbackBonus: 1, balance: 3 });
  });

  it("is off by default and books nothing with „kein Bonus“", async () => {
    const off = await shop("stamp", null); const a = await card(off);
    await stampAt(off, a, berlinDaysAgo(31));
    expect(await give(off, a)).toMatchObject({ winbackBonus: 0 });
    const none = await shop("stamp", { bonus: 0 }); const b = await card(none);
    await stampAt(none, b, berlinDaysAgo(31));
    expect((await lookupCard({ userId: none.owner, locationId: none.locationId, scanCode: b.scanCode })).winbackBonus).toBe(0);
    expect(await give(none, b)).toMatchObject({ winbackBonus: 0 });
    expect((await getCard(b.cardToken)).rulesText).toBe("Ein Stempel pro Besuch.");
  });

  it("works on production while Wallet messages are withheld: the owner sets it, the counter books it, no reminder goes out (ENG-089)", async () => {
    // Cards with message consent are set up first: the consent box itself stays withheld on production.
    const s = await shop("stamp", null); const c = await card(s, "consent"); const later = await card(s, "consent");
    await stampAt(s, c, berlinDaysAgo(31));
    await stampAt(s, later, T("2026-09-20T10:00:00Z"));
    // The birthday bonus is on too: its rules line must stay hidden on production (it waits for Wallet messages).
    await pool.query("UPDATE programs SET birthday_enabled = true, birthday_bonus = 1 WHERE id = $1", [s.programId]);
    vi.stubEnv("PRODUCTION_ENVIRONMENT", "loynara-production");
    expect(await getWinback({ actorUserId: s.owner, programSlug: s.slug })).toMatchObject({ enabled: false });
    expect(await updateWinback({ actorUserId: s.owner, programSlug: s.slug, settings: { enabled: true, days: 30, bonus: 1 } })).toMatchObject({ enabled: true });
    await expect(updateWinback({ actorUserId: await user(), programSlug: s.slug, settings: { enabled: false, days: 30, bonus: 1 } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateWinback({ actorUserId: s.owner, programSlug: s.slug, settings: { enabled: true, days: 30, bonus: 2 } })).rejects.toMatchObject({ code: "INVALID_WINBACK_BONUS" });
    expect((await lookupCard({ userId: s.owner, locationId: s.locationId, scanCode: c.scanCode })).winbackBonus).toBe(1);
    expect(await give(s, c)).toMatchObject({ winbackBonus: 1 });
    // The rules line names the bonus without promising a Wallet reminder.
    expect((await getCard(c.cardToken)).rulesText).toBe(`Ein Stempel pro Besuch.\n\n${winbackRule("stamp", 30, 1, false)}`);
    expect(winbackRule("stamp", 30, 1, false)).toBe("Willkommen-zurück-Bonus: Warst du 30 Tage nicht da, gibt es bei deinem nächsten bestätigten Besuch in den 14 Tagen danach einmal 1 Stempel extra. Nicht auf Tabak, Presse, Bücher, Lotto und Handyguthaben.");
    expect(await queueWinbackMessages(T("2026-10-26T09:00:00Z"))).toBe(0);
  });

  it("shows the bonus in the programme rules on the card and at sign-up while it is on", async () => {
    const s = await shop(); const c = await card(s);
    const rule = winbackRule("stamp", 30, 1);
    expect(rule).toBe("Willkommen-zurück-Bonus: Warst du 30 Tage nicht da, gibt es bei deinem nächsten bestätigten Besuch in den 14 Tagen danach einmal 1 Stempel extra. Mit Nachrichten auf deiner Wallet-Karte erinnern wir dich daran. Nicht auf Tabak, Presse, Bücher, Lotto und Handyguthaben.");
    expect((await getCard(c.cardToken)).rulesText).toBe(`Ein Stempel pro Besuch.\n\n${rule}`);
    expect((await getPublicProgram(s.slug)).rulesText).toBe(`Ein Stempel pro Besuch.\n\n${rule}`);
    // The owner's rule editor gets only the owner's text, so a save never stores the bonus line (ENG-089).
    expect((await getPublicProgram(s.slug)).ownerRulesText).toBe("Ein Stempel pro Besuch.");
  });
});

describe("owner set-up", () => {
  it("limits N to 14–90, stamps to none or 1, points to a quarter of the cheapest reward, owners only", async () => {
    const s = await shop("stamp", null);
    expect(await getWinback({ actorUserId: s.owner, programSlug: s.slug })).toEqual({ enabled: false, days: 30, bonus: 1, bonusMax: 1, type: "stamp", almost: false });
    const set = (settings: { enabled: boolean; days: number; bonus: number }, slug = s.slug, actor = s.owner) => updateWinback({ actorUserId: actor, programSlug: slug, settings });
    await expect(set({ enabled: true, days: 13, bonus: 1 })).rejects.toThrow();
    await expect(set({ enabled: true, days: 91, bonus: 1 })).rejects.toThrow();
    await expect(set({ enabled: true, days: 30, bonus: 2 })).rejects.toMatchObject({ code: "INVALID_WINBACK_BONUS" });
    await expect(set({ enabled: true, days: 30, bonus: 1 }, s.slug, await user())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await set({ enabled: true, days: 14, bonus: 0 })).toMatchObject({ enabled: true, days: 14, bonus: 0 });
    const p = await shop("points", null);
    await expect(set({ enabled: true, days: 30, bonus: 26 }, p.slug, p.owner)).rejects.toMatchObject({ code: "INVALID_WINBACK_BONUS" });
    expect(await set({ enabled: true, days: 90, bonus: 25 }, p.slug, p.owner)).toMatchObject({ bonus: 25, bonusMax: 25, type: "points" });
    // Another shop's owner cannot reach this programme.
    await expect(set({ enabled: false, days: 30, bonus: 1 }, s.slug, p.owner)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a type change before any booking keeps the bonus inside the new type's limit", async () => {
    const p = await shop("points", { bonus: 20 });
    await updateProgram({ actorUserId: p.owner, programSlug: p.slug, name: "Karte", rulesText: "Ein Stempel pro Besuch.", programType: "stamp", earningMode: "manual" });
    expect(await getWinback({ actorUserId: p.owner, programSlug: p.slug })).toMatchObject({ bonus: 1, type: "stamp" });
  });
});

describe("the window across the clock change (Europe/Berlin, 25 Oct 2026)", () => {
  it("counts calendar days in the shop's timezone, not 24-hour blocks or UTC days", async () => {
    const s = await shop(); const c = await card(s);
    await stampAt(s, c, T("2026-09-10T23:00:00Z")); // 11 Sep, 01:00 Berlin (UTC still says 10 Sep)
    const at = (iso: string) => winbackState(db, c.id, T(iso));
    expect(await at("2026-10-10T21:59:00Z")).toBeNull();                                  // 10 Oct 23:59 CEST: day 29
    expect(await at("2026-10-10T22:00:00Z")).toEqual({ bonus: 1, deadline: "2026-10-25" }); // 11 Oct 00:00 CEST: day 30
    expect(await at("2026-10-25T22:59:00Z")).toEqual({ bonus: 1, deadline: "2026-10-25" }); // 25 Oct 23:59 CET (after the change): day 44
    expect(await at("2026-10-25T23:00:00Z")).toBeNull();                                  // 26 Oct 00:00 CET: day 45
  });
});

describe("win-back reminder (Wallet)", () => {
  const MONDAY_10 = T("2026-10-26T09:00:00Z"); // Monday 26 Oct, 10:00 CET (the day after the clock change)
  const fake = () => { const calls: Array<Record<string, unknown>> = []; const send: WalletMessageSend = async ({ data }) => { calls.push(data); }; return { calls, send }; };

  it("goes only Mon–Sat 10:00–18:00 Berlin, also right after the clock change", async () => {
    const s = await shop(); const c = await card(s);
    await stampAt(s, c, T("2026-09-20T10:00:00Z"));
    expect(await queueWinbackMessages(T("2026-10-24T16:00:00Z"))).toBe(0); // Saturday 18:00 CEST
    expect(await queueWinbackMessages(T("2026-10-25T11:00:00Z"))).toBe(0); // Sunday 12:00 CET
    expect(await queueWinbackMessages(T("2026-10-26T08:30:00Z"))).toBe(0); // Monday 09:30 CET (10:30 if the summer offset were used)
    expect(await queueWinbackMessages(MONDAY_10)).toBe(1);
    expect(await queueWinbackMessages(T("2026-10-24T15:59:00Z"))).toBe(0); // Saturday 17:59 would have sent; one per lapse
  });

  it("states the deadline N + 14 days after the last stamp, even when the window delays the send, and delivers it", async () => {
    const s = await shop(); const c = await card(s);
    await stampAt(s, c, T("2026-09-11T10:00:00Z")); // day 44 = 25 Oct, a Sunday: the reminder goes Saturday at the latest
    expect(await queueWinbackMessages(T("2026-10-24T09:00:00Z"))).toBe(1);
    const [message] = await winbackMessages(s);
    expect(message).toMatchObject({ text: "Wir vermissen dich. Komm bis zum 25. Oktober vorbei, dann gibt's einen Stempel extra.", audience: 1 });
    const { rows: [m] } = await pool.query("SELECT id FROM wallet_messages WHERE tenant_id = $1 AND kind = 'winback'", [s.tenantId]);
    const { calls, send } = fake();
    expect(await deliverWalletMessage({ id: randomUUID(), tenantId: s.tenantId, payload: { messageId: m.id } }, { send, now: () => T("2026-10-24T09:00:00Z") })).toEqual({ status: "complete" });
    expect(calls).toHaveLength(1);
    expect(calls[0].message).toBe(message.text);
  });

  it("reaches only consented live passes in their window, one message per deadline date, points and no-bonus texts", async () => {
    const s = await shop("points", { bonus: 20 });
    const early = await card(s); const first = await card(s); const last = await card(s); const late = await card(s); const noConsent = await card(s, "pass"); const plain = await card(s, "none"); const fresh = await card(s);
    await stampAt(s, early, T("2026-09-27T10:00:00Z"));    // day 29 on 26 Oct
    await stampAt(s, first, T("2026-09-26T10:00:00Z"));    // day 30 → deadline 9 Nov
    await stampAt(s, last, T("2026-09-12T10:00:00Z"));     // day 44 → deadline 26 Oct
    await stampAt(s, late, T("2026-09-11T10:00:00Z"));     // day 45
    await stampAt(s, noConsent, T("2026-09-20T10:00:00Z"));
    await stampAt(s, plain, T("2026-09-20T10:00:00Z"));
    expect(await queueWinbackMessages(MONDAY_10)).toBe(2);
    expect(await winbackMessages(s)).toEqual([
      { text: "Wir vermissen dich. Komm bis zum 26. Oktober vorbei, dann gibt's 20 Punkte extra.", audience: 1, members: [last.id] },
      { text: "Wir vermissen dich. Komm bis zum 9. November vorbei, dann gibt's 20 Punkte extra.", audience: 1, members: [first.id] },
    ]);
    expect(fresh).toBeTruthy(); // never stamped: no lapse
    const none = await shop("stamp", { bonus: 0 }); const c = await card(none);
    await stampAt(none, c, T("2026-09-20T10:00:00Z"));
    await queueWinbackMessages(MONDAY_10);
    expect((await winbackMessages(none))[0].text).toBe("Wir vermissen dich. Deine Karte wartet auf dich, schau gern mal wieder vorbei.");
  });

  it("counts against the per-customer cap of 2 in 7 days, and re-arms only after the next confirmed stamp", async () => {
    const s = await shop(); const c = await card(s);
    await stampAt(s, c, T("2026-09-10T10:00:00Z"));
    for (const day of ["2026-10-16T10:00:00Z", "2026-10-21T10:00:00Z"]) {
      const { rows: [m] } = await pool.query("INSERT INTO wallet_messages (tenant_id, program_id, kind, text, status, created_at) VALUES ($1,$2,'owner','Früher','complete',$3) RETURNING id", [s.tenantId, s.programId, day]);
      await pool.query("INSERT INTO wallet_message_recipients (message_id, pass_id, tenant_id, membership_id, status, created_at) VALUES ($1,$2,$3,$4,'sent',$5)", [m.id, c.passId, s.tenantId, c.id, day]);
    }
    expect(await queueWinbackMessages(T("2026-10-23T09:00:00Z"))).toBe(0); // day 43, two owner messages this week
    expect(await queueWinbackMessages(T("2026-10-24T09:00:00Z"))).toBe(1); // day 44, the 16 Oct message left the window
    // Back on 1 Nov: the lapse ends. Day 30 of the next lapse (Tuesday 1 Dec) gets one new reminder.
    await stampAt(s, c, T("2026-11-01T10:00:00Z"));
    expect(await queueWinbackMessages(T("2026-11-30T10:00:00Z"))).toBe(0);
    expect(await queueWinbackMessages(T("2026-12-01T10:00:00Z"))).toBe(1);
  });

  it("a withdrawn consent gets no reminder, but the bonus at the counter stays", async () => {
    const s = await shop(); const c = await card(s);
    await stampAt(s, c, T("2026-09-20T10:00:00Z"));
    await setWalletConsent(c.cardToken, false);
    expect(await queueWinbackMessages(MONDAY_10)).toBe(0);
    expect((await winbackState(db, c.id, MONDAY_10))?.bonus).toBe(1);
  });
});
