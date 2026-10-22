import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { queueAlmostMessages, setAlmostThere } from "./almost-there";
import { createMerchant, enroll } from "./product";
import { credentialHash } from "./wallet/data";
import { deliverWalletMessage, setWalletConsent, type WalletMessageSend } from "./wallet-messages";
import { getWinback } from "./winback";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await pool.end(); });

const T = (iso: string) => new Date(iso);
const NOON = T("2026-10-22T10:00:00Z"); // Thursday 12:00 Berlin
const hoursBefore = (at: Date, hours: number) => new Date(at.getTime() - hours * 3_600_000);

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic owner", `${id}@example.test`]);
  return id;
}
async function shop(type: "stamp" | "points" = "stamp", on = true) {
  const owner = await user();
  const m = await createMerchant({ userId: owner, businessName: "Synthetic Pizzeria", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Karte", programType: type, rulesText: "Ein Stempel pro Pizza.", rewardTitle: "Pizza gratis", rewardCost: type === "stamp" ? 10 : 100 });
  const s = { owner, slug: m.programSlug, programId: m.programId, locationId: m.locationId, tenantId: m.tenantId };
  // The reward's first version takes the database's real time. Every test runs at pinned instants (NOON, the DST nights), so
  // an identical second version, effective long before them, keeps the suite independent of when it runs (history is append-only).
  await pool.query(`INSERT INTO reward_versions (tenant_id, reward_id, version, title, cost, terms_text, effective_at)
    SELECT tenant_id, reward_id, version + 1, title, cost, terms_text, '2026-01-01T00:00:00Z' FROM reward_versions
    WHERE reward_id = (SELECT id FROM rewards WHERE program_id = $1)`, [m.programId]);
  if (on) await setAlmostThere({ actorUserId: owner, programSlug: s.slug, enabled: true });
  return s;
}
type Shop = Awaited<ReturnType<typeof shop>>;
async function card(s: Shop, wallet: "consent" | "pass" | "none" = "consent") {
  const c = await enroll({ slug: s.slug, acceptedTerms: true });
  const { rows: [m] } = await pool.query("SELECT scan_code FROM memberships WHERE id = $1", [c.id]);
  const passId = randomUUID();
  if (wallet !== "none") await pool.query("INSERT INTO wallet_passes (id, tenant_id, membership_id, provider, provider_object_id, credential_hash, status) VALUES ($1,$2,$3,'apple',$4,$5,'created')",
    [passId, s.tenantId, c.id, `passfast:${passId}`, credentialHash(m.scan_code)]);
  if (wallet === "consent") await setWalletConsent(c.cardToken, true);
  return { ...c, passId };
}
type Card = Awaited<ReturnType<typeof card>>;
/** A confirmed award (or, with a negative delta, a redemption) booked at `at`; the ledger is append-only, so it is inserted with its time. */
async function book(s: Shop, c: Card, delta: number, at: Date) {
  await pool.query(`INSERT INTO ledger_entries (tenant_id, location_id, membership_id, delta, kind, source, actor_user_id, request_id, idempotency_key, created_at)
    VALUES ($1,$2,$3,$4,$5,'staff_online',$6,$7,$8,$9)`, [s.tenantId, s.locationId, c.id, delta, delta > 0 ? "award" : "redeem", s.owner, randomUUID(), randomUUID(), at]);
  await pool.query("UPDATE memberships SET balance = balance + $2 WHERE id = $1", [c.id, delta]);
}
const messages = async (s: Shop) => (await pool.query(`SELECT w.text, array_agg(r.membership_id::text ORDER BY r.membership_id) AS members
  FROM wallet_messages w JOIN wallet_message_recipients r ON r.message_id = w.id WHERE w.tenant_id = $1 AND w.kind = 'almost' GROUP BY w.id ORDER BY w.created_at, w.text`, [s.tenantId])).rows;

describe("„Fast geschafft“ reminder", () => {
  it("goes to a card 1 stamp from its reward after a recent stamp, with Marketing's text, and is delivered", async () => {
    const s = await shop(); const nine = await card(s); const eight = await card(s); const ten = await card(s);
    await book(s, nine, 9, hoursBefore(NOON, 1)); await book(s, eight, 8, hoursBefore(NOON, 1)); await book(s, ten, 10, hoursBefore(NOON, 1));
    expect(await queueAlmostMessages(NOON)).toBe(1);
    expect(await messages(s)).toEqual([{ text: "Nur noch 1 Stempel bis zu deiner Prämie: Pizza gratis.", members: [nine.id] }]);
    const { rows: [m] } = await pool.query("SELECT id FROM wallet_messages WHERE tenant_id = $1 AND kind = 'almost'", [s.tenantId]);
    const calls: Array<Record<string, unknown>> = [];
    const send: WalletMessageSend = async ({ data }) => { calls.push(data); };
    expect(await deliverWalletMessage({ id: randomUUID(), tenantId: s.tenantId, payload: { messageId: m.id } }, { send, now: () => NOON })).toEqual({ status: "complete" });
    expect(calls).toHaveLength(1);
  });

  it("is once per reward cycle: nothing more until the card redeems, then once again", async () => {
    const s = await shop(); const c = await card(s);
    await book(s, c, 9, hoursBefore(NOON, 1));
    expect(await queueAlmostMessages(NOON)).toBe(1);
    expect(await queueAlmostMessages(hoursBefore(NOON, -1))).toBe(0);
    await book(s, c, 1, hoursBefore(NOON, -24)); await book(s, c, -10, hoursBefore(NOON, -24));
    await book(s, c, 9, hoursBefore(NOON, -48));
    expect(await queueAlmostMessages(hoursBefore(NOON, -49))).toBe(1);
  });

  it("points: up to 10 points from the next reward, the gap in the text", async () => {
    const s = await shop("points"); const a = await card(s); const b = await card(s); const far = await card(s);
    await book(s, a, 90, hoursBefore(NOON, 2)); await book(s, b, 95, hoursBefore(NOON, 2)); await book(s, far, 89, hoursBefore(NOON, 2));
    expect(await queueAlmostMessages(NOON)).toBe(2);
    expect((await messages(s)).map(m => m.text).sort()).toEqual(["Nur noch 10 Punkte bis zu deiner Prämie: Pizza gratis.", "Nur noch 5 Punkte bis zu deiner Prämie: Pizza gratis."]);
  });

  it("needs consent and a live pass, the owner's switch (off by default) and a stamp within 48 hours", async () => {
    const off = await shop("stamp", false); const o = await card(off);
    await book(off, o, 9, hoursBefore(NOON, 1));
    expect(await getWinback({ actorUserId: off.owner, programSlug: off.slug })).toMatchObject({ almost: false });
    const s = await shop(); const noConsent = await card(s, "pass"); const plain = await card(s, "none"); const stale = await card(s); const fresh = await card(s);
    for (const c of [noConsent, plain]) await book(s, c, 9, hoursBefore(NOON, 1));
    await book(s, stale, 9, hoursBefore(NOON, 48)); await book(s, fresh, 9, hoursBefore(NOON, 47));
    expect(await queueAlmostMessages(NOON)).toBe(1);
    expect((await messages(s))[0].members).toEqual([fresh.id]);
    await expect(setAlmostThere({ actorUserId: await user(), programSlug: s.slug, enabled: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("waits outside quiet hours 21–8 Berlin, also on the morning after the clock change", async () => {
    const s = await shop(); const c = await card(s);
    await book(s, c, 9, T("2026-10-25T19:00:00Z"));
    expect(await queueAlmostMessages(T("2026-10-25T20:00:00Z"))).toBe(0); // Sunday 21:00 CET
    expect(await queueAlmostMessages(T("2026-10-26T06:59:00Z"))).toBe(0); // Monday 07:59 CET (08:59 with the summer offset)
    expect(await queueAlmostMessages(T("2026-10-26T07:00:00Z"))).toBe(1); // 08:00 CET
  });

  it("counts against the per-customer cap of 2 in 7 days, and is withheld with the walletMessages surface", async () => {
    const s = await shop(); const c = await card(s);
    for (const day of ["2026-10-15T12:00:00Z", "2026-10-20T10:00:00Z"]) {
      const { rows: [m] } = await pool.query("INSERT INTO wallet_messages (tenant_id, program_id, kind, text, status, created_at) VALUES ($1,$2,'owner','Früher','complete',$3) RETURNING id", [s.tenantId, s.programId, day]);
      await pool.query("INSERT INTO wallet_message_recipients (message_id, pass_id, tenant_id, membership_id, status, created_at) VALUES ($1,$2,$3,$4,'sent',$5)", [m.id, c.passId, s.tenantId, c.id, day]);
    }
    await book(s, c, 9, hoursBefore(NOON, 1));
    expect(await queueAlmostMessages(NOON)).toBe(0);
    vi.stubEnv("PRODUCTION_ENVIRONMENT", "loynara-production");
    expect(await queueAlmostMessages(T("2026-10-22T13:00:00Z"))).toBe(0);
    await expect(setAlmostThere({ actorUserId: s.owner, programSlug: s.slug, enabled: false })).rejects.toMatchObject({ code: "NOT_FOUND" });
    vi.unstubAllEnvs();
    expect(await queueAlmostMessages(T("2026-10-22T13:00:00Z"))).toBe(1); // the 15 Oct message left the 7-day window
  });
});
