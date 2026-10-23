import { createHmac, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { createMerchant, enroll } from "./product";
import { credentialHash } from "./wallet/data";
import { passFastData } from "./wallet/passfast";
import { walletCardSnapshot } from "./wallet/data";
import { consentText, CONSENT_TEXT_VERSION } from "./wallet-message-rules";
import { POST } from "@/app/api/wallet/passfast-events/route";
import { recordPassFastEvent } from "./wallet-pass-events";
import { acknowledgeWalletGuidance, deliverWalletMessage, type WalletMessageGoogleSend, removalWarning, walletMessageStats, getWalletConsent, sendWalletMessage, setWalletConsent, stopWalletMessage, walletMessageOverview, type WalletMessageSend } from "./wallet-messages";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await pool.end(); });

const T = (iso: string) => new Date(iso);
const NOON = T("2026-10-22T10:00:00Z"); // 12:00 Berlin
const TEXT = "Heute ruhig: Kaffee zum halben Preis bis 17 Uhr.";

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic owner", `${id}@example.test`]);
  return id;
}
async function shop(name = "Synthetic Café", acknowledged = true) {
  const owner = await user();
  const merchant = await createMerchant({ userId: owner, businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 10 });
  const { rows: [t] } = await pool.query("SELECT tenant_id AS id FROM programs WHERE id = $1", [merchant.programId]);
  if (acknowledged) await acknowledgeWalletGuidance({ actorUserId: owner, programSlug: merchant.programSlug });
  return { owner, slug: merchant.programSlug, programId: merchant.programId, tenantId: t.id as string };
}
type Shop = Awaited<ReturnType<typeof shop>>;
/** A card holding a live Apple pass, optionally with the customer's consent. */
async function customer(s: Shop, consent = true) {
  const card = await enroll({ slug: s.slug, acceptedTerms: true });
  const { rows: [m] } = await pool.query("SELECT scan_code FROM memberships WHERE id = $1", [card.id]);
  const passId = randomUUID();
  await pool.query("INSERT INTO wallet_passes (id, tenant_id, membership_id, provider, provider_object_id, credential_hash, status) VALUES ($1,$2,$3,'apple',$4,$5,'created')",
    [passId, s.tenantId, card.id, `passfast:${passId}`, credentialHash(m.scan_code)]);
  if (consent) await setWalletConsent(card.cardToken, true);
  return { ...card, passId };
}
const fake = () => { const calls: Array<{ objectId: string; data: Record<string, unknown> }> = []; const send: WalletMessageSend = async ({ objectId, data }) => { calls.push({ objectId, data }); }; return { calls, send }; };
async function drain(messageId: string, tenantId: string, send: WalletMessageSend, now = NOON) {
  let outcome = await deliverWalletMessage({ id: randomUUID(), tenantId, payload: { messageId } }, { send, now: () => now });
  for (let i = 0; i < 20 && outcome.status === "deferred"; i++) outcome = await deliverWalletMessage({ id: randomUUID(), tenantId, payload: { messageId } }, { send, now: () => now });
  return outcome;
}
const go = (s: Shop, now = NOON, text = TEXT) => sendWalletMessage({ actorUserId: s.owner, programSlug: s.slug, text }, now);
const recipientStatuses = async (messageId: string) => (await pool.query("SELECT status, reason FROM wallet_message_recipients WHERE message_id = $1 ORDER BY pass_id", [messageId])).rows;
/** Earlier marketing messages of a card (ENG-044 will write the same rows). */
async function priorMessage(s: Shop, membershipId: string, passId: string, createdAt: Date, status = "sent") {
  const { rows: [m] } = await pool.query("INSERT INTO wallet_messages (tenant_id, program_id, kind, text, status, created_at) VALUES ($1,$2,'winback','Früher',$3,$4) RETURNING id", [s.tenantId, s.programId, "complete", createdAt]);
  await pool.query("INSERT INTO wallet_message_recipients (message_id, pass_id, tenant_id, membership_id, status, created_at) VALUES ($1,$2,$3,$4,$5,$6)", [m.id, passId, s.tenantId, membershipId, status, createdAt]);
}

describe("consent gate", () => {
  it("sends nothing to a card without consent and counts only consenting cards as reach", async () => {
    const s = await shop(); const withConsent = await customer(s); await customer(s, false);
    const { calls, send } = fake();
    expect((await walletMessageOverview({ actorUserId: s.owner, programSlug: s.slug }, NOON)).reach).toBe(1);
    const { id, audience } = await go(s);
    expect(audience).toBe(1);
    expect(await drain(id, s.tenantId, send)).toEqual({ status: "complete" });
    expect(calls).toHaveLength(1);
    expect(calls[0].objectId).toBe(`passfast:${withConsent.passId}`);
  });

  it("sends the full data contract unchanged apart from the one new message, and a refresh keeps the message", async () => {
    const s = await shop(); const c = await customer(s);
    await pool.query("UPDATE memberships SET balance = 4 WHERE id = $1", [c.id]);
    const { calls, send } = fake();
    const { id } = await go(s); await drain(id, s.tenantId, send);
    const snapshot = await walletCardSnapshot(c.id);
    if (!snapshot.open) throw new Error("open");
    expect(calls[0].data).toEqual({ ...passFastData({ ...snapshot.pass, message: undefined }), message: TEXT });
    expect(calls[0].data).toMatchObject({ balance: 4 });
    expect(passFastData(snapshot.pass).message).toBeUndefined(); // flag off: refreshes keep the earlier contract
    expect(passFastData(snapshot.pass, { WALLET_MESSAGES_ENABLED: "true" }).message).toBe(TEXT);
  });

  it("an opt-out in the middle of a send stops that card's message", async () => {
    const s = await shop(); const a = await customer(s); const b = await customer(s);
    const { id } = await go(s);
    const sent: string[] = [];
    // While the first card is being sent, the other customer switches messages off.
    const send: WalletMessageSend = async ({ objectId }) => {
      sent.push(objectId);
      const other = objectId === `passfast:${a.passId}` ? b : a;
      await setWalletConsent(other.cardToken, false);
    };
    await drain(id, s.tenantId, send);
    expect(sent).toHaveLength(1);
    expect((await recipientStatuses(id)).map(r => r.status).sort()).toEqual(["sent", "skipped"]);
    expect((await recipientStatuses(id)).find(r => r.status === "skipped")?.reason).toBe("no_consent");
  });

  it("card page consent: Legal's text with the card's shop and location, only for an Apple pass, saved with version and channel, off switch keeps the pass", async () => {
    const s = await shop("Café Kurz"); const c = await customer(s, false);
    const plain = await enroll({ slug: s.slug, acceptedTerms: true });
    expect(await getWalletConsent(plain.cardToken)).toMatchObject({ available: false, granted: false });
    await expect(setWalletConsent(plain.cardToken, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { rows: [l] } = await pool.query("SELECT l.name FROM programs p JOIN locations l ON l.id = p.location_id WHERE p.id = $1", [s.programId]);
    const view = await getWalletConsent(c.cardToken);
    expect(view).toMatchObject({ available: true, granted: false, text: consentText("Café Kurz", l.name) });
    expect(view.text).toBe(`Ja, Café Kurz, ${l.name}, darf mir Angebote, Neuigkeiten und Erinnerungen als Nachricht auf meiner Wallet-Karte schicken (höchstens 2 pro Woche). Das ist freiwillig und für die Karte nicht nötig. Ich kann es jederzeit hier auf meiner Karte abschalten. Mehr in den Datenschutzhinweisen.`);
    await setWalletConsent(c.cardToken, true); await setWalletConsent(c.cardToken, true);
    expect((await pool.query("SELECT text_version, channel, withdrawn_at FROM wallet_message_consents WHERE membership_id = $1", [c.id])).rows).toEqual([{ text_version: CONSENT_TEXT_VERSION, channel: "wallet", withdrawn_at: null }]);
    await setWalletConsent(c.cardToken, false);
    expect((await pool.query("SELECT status, revoked_at FROM wallet_passes WHERE id = $1", [c.passId])).rows[0]).toEqual({ status: "created", revoked_at: null });
    await expect(getWalletConsent("card_unknown")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("the consent log is append-only: only a first withdrawal is allowed, a new grant is a new row", async () => {
    const s = await shop(); const c = await customer(s);
    await expect(pool.query("DELETE FROM wallet_message_consents")).rejects.toThrow(/append-only/);
    await expect(pool.query("UPDATE wallet_message_consents SET given_at = now() - interval '1 year'")).rejects.toThrow(/append-only/);
    await expect(pool.query("UPDATE wallet_message_consents SET text_version = 'x'")).rejects.toThrow(/append-only/);
    await setWalletConsent(c.cardToken, false);
    await expect(pool.query("UPDATE wallet_message_consents SET withdrawn_at = now()")).rejects.toThrow(/append-only/);
    await setWalletConsent(c.cardToken, true);
    expect((await pool.query("SELECT withdrawn_at IS NULL AS open FROM wallet_message_consents ORDER BY given_at")).rows).toEqual([{ open: false }, { open: true }]);
  });

  it("is withheld on real production and offered again with the founder's switch", async () => {
    const s = await shop(); const c = await customer(s);
    vi.stubEnv("PRODUCTION_ENVIRONMENT", "loynara-production");
    try {
      await expect(getWalletConsent(c.cardToken)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(setWalletConsent(c.cardToken, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(go(s)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(walletMessageOverview({ actorUserId: s.owner, programSlug: s.slug })).rejects.toMatchObject({ code: "NOT_FOUND" });
      vi.stubEnv("WALLET_MESSAGES_ENABLED", "true");
      expect(await getWalletConsent(c.cardToken)).toMatchObject({ available: true });
    } finally { vi.unstubAllEnvs(); }
  });
});

describe("caps", () => {
  it("allows 2 messages per shop in a rolling 7 days, the 3rd is refused with the time it frees up, and a 7-day-old one no longer counts", async () => {
    const s = await shop(); await customer(s);
    await go(s, T("2026-10-20T10:00:00Z"));
    await go(s, T("2026-10-21T10:00:00Z"));
    const refused = await go(s, T("2026-10-22T10:00:00Z")).catch(error => error);
    expect(refused).toMatchObject({ code: "SHOP_CAP" });
    expect(refused.message).toMatch(/Dienstag, 27\. Oktober, 11:00 Uhr/); // 20 Oct 12:00 CEST + 7 days = 11:00 CET (clocks went back on 25 Oct)
    expect(await walletMessageOverview({ actorUserId: s.owner, programSlug: s.slug }, T("2026-10-22T10:00:00Z"))).toMatchObject({ remaining: 0, nextAllowedAt: new Date("2026-10-27T10:00:00Z") });
    // The first message is 7 days + 1 minute old: only one message is left in the window.
    expect((await walletMessageOverview({ actorUserId: s.owner, programSlug: s.slug }, T("2026-10-27T10:01:00Z"))).remaining).toBe(1);
  });

  it("shows the next 08:00 when the window reopens inside quiet hours", async () => {
    const s = await shop(); await customer(s);
    await go(s, T("2026-10-20T06:00:00Z")); // 08:00 CEST
    await go(s, T("2026-10-21T10:00:00Z"));
    // +7 days is 07:00 CET, inside quiet hours: the earliest real send time is 08:00 CET.
    const refused = await go(s, T("2026-10-22T10:00:00Z")).catch(error => error);
    expect(refused.message).toMatch(/Dienstag, 27\. Oktober, 0?8:00 Uhr\./);
    expect((await walletMessageOverview({ actorUserId: s.owner, programSlug: s.slug }, T("2026-10-22T10:00:00Z"))).nextAllowedAt).toEqual(new Date("2026-10-27T07:00:00Z"));
    await expect(go(s, T("2026-10-27T07:00:00Z"))).resolves.toMatchObject({ audience: 1 });
  });

  it("a message stopped before any delivery does not use the shop's allowance", async () => {
    const s = await shop(); await customer(s);
    const { id } = await go(s, T("2026-10-22T08:00:00Z"));
    await stopWalletMessage({ actorUserId: s.owner, programSlug: s.slug, messageId: id });
    expect((await walletMessageOverview({ actorUserId: s.owner, programSlug: s.slug }, NOON)).remaining).toBe(2);
  });

  it("holds the per-customer cap of 2 in a rolling 7 days exactly, counting earlier win-back rows too", async () => {
    const s = await shop(); const c = await customer(s);
    const overview = () => walletMessageOverview({ actorUserId: s.owner, programSlug: s.slug }, NOON);
    // One earlier message 7 days + 1 minute old: it no longer counts, the customer has room for two.
    await priorMessage(s, c.id, c.passId, new Date(NOON.getTime() - (7 * 86400 + 60) * 1000));
    expect((await overview()).reach).toBe(1);
    // One counted message 7 days minus 1 minute old: the 2nd message passes ...
    await pool.query("TRUNCATE wallet_message_recipients CASCADE");
    await priorMessage(s, c.id, c.passId, new Date(NOON.getTime() - (7 * 86400 - 60) * 1000));
    expect((await overview()).reach).toBe(1);
    const second = await go(s);
    expect(second.audience).toBe(1);
    // ... and the 3rd is refused: the customer is at 2, so nobody can be reached.
    expect((await overview()).reach).toBe(0);
    await expect(go(s)).rejects.toMatchObject({ code: "NO_REACH" });
    // A failed or skipped delivery never used the allowance.
    await pool.query("UPDATE wallet_message_recipients SET status = 'failed', reason = 'provider' WHERE message_id = $1", [second.id]);
    expect((await overview()).reach).toBe(1);
  });
});

describe("quiet hours 21:00 to 08:00 Berlin, including the DST change of 25 Oct 2026", () => {
  it.each([
    ["20:59 CEST the evening before", "2026-10-24T18:59:00Z", true],
    ["21:00 CEST", "2026-10-24T19:00:00Z", false],
    ["07:30 CET after the clocks went back", "2026-10-25T06:30:00Z", false],
    ["07:59 CET", "2026-10-25T06:59:00Z", false],
    ["08:00 CET", "2026-10-25T07:00:00Z", true],
    ["03:00 in the repeated hour", "2026-10-25T01:30:00Z", false],
  ])("%s", async (_label, iso, allowed) => {
    const s = await shop(); await customer(s);
    if (allowed) await expect(go(s, T(iso))).resolves.toMatchObject({ audience: 1 });
    else {
      await expect(go(s, T(iso))).rejects.toMatchObject({ code: "QUIET_HOURS", message: expect.stringContaining("Zwischen 21 und 8 Uhr senden wir keine Nachrichten") });
      expect((await pool.query("SELECT count(*)::int AS n FROM wallet_messages")).rows[0].n).toBe(0); // refused, not queued
    }
  });

  it("a delivery that reaches 21:00 waits for 08:00 and sends nothing meanwhile", async () => {
    const s = await shop(); await customer(s);
    const { id } = await go(s, T("2026-10-22T18:30:00Z"));
    const { calls, send } = fake();
    const late = await deliverWalletMessage({ id: randomUUID(), tenantId: s.tenantId, payload: { messageId: id } }, { send, now: () => T("2026-10-22T19:30:00Z") });
    expect(late).toMatchObject({ status: "deferred", until: new Date("2026-10-23T06:00:00Z") });
    expect(calls).toHaveLength(0);
  });
});

describe("content rules", () => {
  it.each(["Heute Tabak zum Sonderpreis", "Neue Liquids da", "Vape-Aktion", "Snus 2 für 1", "Das hilft: heilt Rückenschmerzen", "Bier und Wein für Jugendliche heute günstig", "Mehr unter www.beispiel.de", "Alles auf https://x.test"])("refuses %s", async text => {
    const s = await shop(); await customer(s);
    await expect(go(s, NOON, text)).rejects.toMatchObject({ code: "MESSAGE_REFUSED" });
  });
  it("refuses 141 characters and empty text, accepts 140", async () => {
    const s = await shop(); await customer(s);
    await expect(go(s, NOON, "a".repeat(141))).rejects.toMatchObject({ code: "MESSAGE_REFUSED" });
    await expect(go(s, NOON, "   ")).rejects.toMatchObject({ code: "MESSAGE_REFUSED" });
    await expect(go(s, NOON, "a".repeat(140))).resolves.toMatchObject({ audience: 1 });
  });
  it("the owner's first send needs Legal's guidance acknowledged once; it is stored with its version", async () => {
    const s = await shop("Synthetic Café", false); await customer(s);
    expect((await walletMessageOverview({ actorUserId: s.owner, programSlug: s.slug }, NOON)).guidanceConfirmed).toBe(false);
    await expect(go(s)).rejects.toMatchObject({ code: "CONFIRM_REQUIRED" });
    await acknowledgeWalletGuidance({ actorUserId: s.owner, programSlug: s.slug }, NOON); await acknowledgeWalletGuidance({ actorUserId: s.owner, programSlug: s.slug }, NOON);
    expect((await walletMessageOverview({ actorUserId: s.owner, programSlug: s.slug }, NOON)).guidanceConfirmed).toBe(true);
    await go(s);
    expect((await pool.query("SELECT version, confirmed_by_user_id FROM wallet_message_owner_confirmations")).rows).toEqual([{ version: expect.stringMatching(/^wallet-owner-/), confirmed_by_user_id: s.owner }]);
    expect((await pool.query("SELECT confirm_version FROM wallet_messages")).rows[0].confirm_version).toMatch(/^wallet-owner-/);
    await expect(sendWalletMessage({ actorUserId: await user(), programSlug: s.slug, text: TEXT }, NOON)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("delivery", () => {
  it("is idempotent per (message, pass): running the job again, or after completion, sends nothing twice", async () => {
    const s = await shop(); await customer(s); await customer(s); await customer(s);
    const { calls, send } = fake();
    const { id, audience } = await go(s);
    expect(audience).toBe(3);
    await drain(id, s.tenantId, send);
    expect(await deliverWalletMessage({ id: randomUUID(), tenantId: s.tenantId, payload: { messageId: id } }, { send })).toMatchObject({ status: "suppressed" });
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map(call => call.objectId)).size).toBe(3);
    expect((await pool.query("SELECT status, sent_count, audience_count FROM wallet_messages WHERE id = $1", [id])).rows[0]).toEqual({ status: "complete", sent_count: 3, audience_count: 3 });
    await expect(pool.query("INSERT INTO wallet_message_recipients (message_id, pass_id, tenant_id, membership_id) SELECT message_id, pass_id, tenant_id, membership_id FROM wallet_message_recipients LIMIT 1")).rejects.toThrow();
  });

  it("works through recipients in chunks and keeps going until all are done", async () => {
    const s = await shop(); for (let i = 0; i < 6; i++) await customer(s);
    const { calls, send } = fake();
    const { id } = await go(s);
    const first = await deliverWalletMessage({ id: randomUUID(), tenantId: s.tenantId, payload: { messageId: id } }, { send, now: () => NOON });
    expect(first).toMatchObject({ status: "deferred" });
    expect(calls).toHaveLength(4);
    expect((await drain(id, s.tenantId, send)).status).toBe("complete");
    expect(calls).toHaveLength(6);
  });

  it("retries a provider failure at most twice, never twice at once, and then marks the recipient failed", async () => {
    const s = await shop(); await customer(s);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let attempts = 0;
    const send: WalletMessageSend = async () => { attempts++; throw Object.assign(new Error(`provider said: ${TEXT} anna@example.test`), { name: "PassFastError" }); };
    const { id } = await go(s);
    for (let i = 0; i < 6; i++) {
      await pool.query("UPDATE wallet_message_recipients SET retry_at = now() WHERE status = 'queued'");
      await deliverWalletMessage({ id: randomUUID(), tenantId: s.tenantId, payload: { messageId: id } }, { send, now: () => NOON });
    }
    expect(attempts).toBe(3);
    expect((await recipientStatuses(id))[0]).toEqual({ status: "failed", reason: "provider" });
    expect((await pool.query("SELECT status, failed_count FROM wallet_messages WHERE id = $1", [id])).rows[0]).toEqual({ status: "complete", failed_count: 1 });
    // No message text, address or provider detail reaches the logs.
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("Kaffee"); expect(logged).not.toContain("anna@example.test"); expect(logged).toContain("PassFastError");
  });

  it("never sends again when the outcome of an earlier attempt is unknown", async () => {
    const s = await shop(); const c = await customer(s);
    const { id } = await go(s);
    // A worker died after claiming the recipient (and maybe after the provider call).
    await pool.query("UPDATE wallet_message_recipients SET status = 'sending', attempts = 1, claimed_at = now() - interval '11 minutes'");
    const { calls, send } = fake();
    expect((await drain(id, s.tenantId, send)).status).toBe("complete");
    expect(calls).toHaveLength(0);
    expect((await recipientStatuses(id))[0]).toEqual({ status: "failed", reason: "uncertain" });
    // The unknown send still counts against the customer's weekly allowance.
    expect((await walletMessageOverview({ actorUserId: s.owner, programSlug: s.slug }, NOON)).reach).toBe(1);
    await priorMessage(s, c.id, c.passId, NOON);
    expect((await walletMessageOverview({ actorUserId: s.owner, programSlug: s.slug }, NOON)).reach).toBe(0);
  });

  it("the stop switch skips what is still queued", async () => {
    const s = await shop(); await customer(s); await customer(s);
    const { calls, send } = fake();
    const { id } = await go(s);
    await stopWalletMessage({ actorUserId: s.owner, programSlug: s.slug, messageId: id });
    expect(await deliverWalletMessage({ id: randomUUID(), tenantId: s.tenantId, payload: { messageId: id } }, { send })).toMatchObject({ status: "suppressed" });
    expect(calls).toHaveLength(0);
    expect((await pool.query("SELECT status, skipped_count FROM wallet_messages WHERE id = $1", [id])).rows[0]).toEqual({ status: "stopped", skipped_count: 2 });
    await expect(stopWalletMessage({ actorUserId: s.owner, programSlug: s.slug, messageId: id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("skips a pass that was revoked or whose card was closed after the send was queued", async () => {
    const s = await shop(); const a = await customer(s); const b = await customer(s);
    const { id } = await go(s);
    await pool.query("UPDATE wallet_passes SET status = 'revoked', revoked_at = now(), revoke_reason = 'closed' WHERE id = $1", [a.passId]);
    await pool.query("UPDATE memberships SET closed_at = now() WHERE id = $1", [b.id]);
    const { calls, send } = fake();
    await drain(id, s.tenantId, send);
    expect(calls).toHaveLength(0);
    expect((await recipientStatuses(id)).map(r => r.reason)).toEqual(["pass_gone", "pass_gone"]);
  });
});

describe("tenant scope and roles", () => {
  it("another shop's owner reaches none of this shop's cards, cannot stop its messages and cannot run its job", async () => {
    const a = await shop("Laden A"); const b = await shop("Laden B");
    await customer(a);
    expect((await walletMessageOverview({ actorUserId: b.owner, programSlug: b.slug }, NOON)).reach).toBe(0);
    await expect(go(b)).rejects.toMatchObject({ code: "NO_REACH" });
    await expect(sendWalletMessage({ actorUserId: b.owner, programSlug: a.slug, text: TEXT }, NOON)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { id } = await go(a);
    await expect(stopWalletMessage({ actorUserId: b.owner, programSlug: b.slug, messageId: id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { calls, send } = fake();
    expect(await deliverWalletMessage({ id: randomUUID(), tenantId: b.tenantId, payload: { messageId: id } }, { send })).toMatchObject({ status: "blocked" });
    expect(calls).toHaveLength(0);
    expect((await walletMessageOverview({ actorUserId: b.owner, programSlug: b.slug }, NOON)).history).toEqual([]);
  });

  it("only an active owner may use it", async () => {
    const s = await shop(); await customer(s);
    const stranger = await user();
    await expect(sendWalletMessage({ actorUserId: stranger, programSlug: s.slug, text: TEXT }, NOON)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(walletMessageOverview({ actorUserId: stranger, programSlug: s.slug })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(stopWalletMessage({ actorUserId: stranger, programSlug: s.slug, messageId: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await pool.query("UPDATE staff_roles SET role = 'manager', location_id = (SELECT location_id FROM programs WHERE id = $2) WHERE user_id = $1", [s.owner, s.programId]);
    await expect(go(s)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("reach 0 refuses the send and writes nothing", async () => {
    const s = await shop(); await customer(s, false);
    await expect(go(s)).rejects.toMatchObject({ code: "NO_REACH" });
    expect((await pool.query("SELECT (SELECT count(*) FROM wallet_messages)::int AS m, (SELECT count(*) FROM outbox_jobs WHERE kind = 'wallet.message')::int AS j")).rows[0]).toEqual({ m: 0, j: 0 });
  });

  it("queues one outbox job and records who sent what", async () => {
    const s = await shop(); await customer(s);
    const { id } = await go(s);
    expect((await pool.query("SELECT payload FROM outbox_jobs WHERE kind = 'wallet.message'")).rows).toEqual([{ payload: { messageId: id } }]);
    const overview = await walletMessageOverview({ actorUserId: s.owner, programSlug: s.slug }, NOON);
    expect(overview.history).toMatchObject([{ id, text: TEXT, status: "queued", audience: 1 }]);
    expect((await pool.query("SELECT sent_by_user_id, text FROM wallet_messages")).rows).toEqual([{ sent_by_user_id: s.owner, text: TEXT }]);
  });
});

// ---- PassFast event webhook and the removal report ---------------------------------------------------------------

const SECRET = "synthetic-webhook-secret-0123456789";
const sign = (raw: string, secret = SECRET) => createHmac("sha256", secret).update(raw).digest("hex");
const eventBody = (serial: string, event: string, at: Date) => JSON.stringify({ event, pass_id: randomUUID(), serial_number: serial, device_id: "synthetic-device-id-777", timestamp: at.toISOString() });
const hook = (raw: string, signature: string | null, now: Date) => recordPassFastEvent(raw, signature, now, { PASSFAST_WEBHOOK_SECRET: SECRET });
const events = async () => (await pool.query("SELECT * FROM wallet_pass_events ORDER BY event_at")).rows;

describe("PassFast event webhook", () => {
  it("records a signed device event with only type, pass and time, once per (event, pass, timestamp)", async () => {
    const s = await shop(); const c = await customer(s);
    const raw = eventBody(c.passId, "device.unregistered", NOON);
    expect(await hook(raw, sign(raw), NOON)).toEqual({ recorded: true });
    expect(await hook(raw, sign(raw), NOON)).toEqual({ recorded: false }); // replay / retry
    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(["event", "event_at", "id", "pass_id", "received_at", "tenant_id"]);
    expect(rows[0]).toMatchObject({ pass_id: c.passId, tenant_id: s.tenantId, event: "device.unregistered", event_at: NOON });
    expect(JSON.stringify(rows[0])).not.toContain("synthetic-device-id");
  });

  it("refuses a missing, malformed, wrong or tampered signature and stores nothing", async () => {
    const s = await shop(); const c = await customer(s);
    const raw = eventBody(c.passId, "device.unregistered", NOON);
    for (const bad of [null, "", "abc", "z".repeat(64), sign(raw, "another-secret-another-secret"), sign(raw + " ")]) {
      await expect(hook(raw, bad, NOON), String(bad)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    }
    expect(await events()).toEqual([]);
  });

  it("rejects timestamps more than 10 minutes old or ahead, accepts 10 minutes exactly", async () => {
    const s = await shop(); const c = await customer(s);
    const at = (ms: number) => new Date(NOON.getTime() + ms);
    for (const offset of [-10 * 60_000 - 1, 10 * 60_000 + 1]) {
      const raw = eventBody(c.passId, "device.unregistered", at(offset));
      await expect(hook(raw, sign(raw), NOON)).rejects.toMatchObject({ code: "INVALID_EVENT" });
    }
    const raw = eventBody(c.passId, "device.unregistered", at(-10 * 60_000));
    expect(await hook(raw, sign(raw), NOON)).toEqual({ recorded: true });
    const unparsable = "{not json";
    await expect(hook(unparsable, sign(unparsable), NOON)).rejects.toMatchObject({ code: "INVALID_EVENT" });
  });

  it("acknowledges an unknown serial, another provider's pass and uninteresting events without storing them", async () => {
    const s = await shop(); const c = await customer(s);
    const unknown = eventBody(randomUUID(), "device.unregistered", NOON);
    expect(await hook(unknown, sign(unknown), NOON)).toEqual({ recorded: false });
    const updated = eventBody(c.passId, "pass.updated", NOON);
    expect(await hook(updated, sign(updated), NOON)).toEqual({ recorded: false });
    await pool.query("UPDATE wallet_passes SET provider_object_id = 'native-apple-pass' WHERE id = $1", [c.passId]);
    const native = eventBody(c.passId, "device.unregistered", NOON);
    expect(await hook(native, sign(native), NOON)).toEqual({ recorded: false });
    expect(await events()).toEqual([]);
  });

  it("does not exist without a secret or while the surface is withheld on production", async () => {
    const raw = eventBody(randomUUID(), "device.unregistered", NOON);
    await expect(recordPassFastEvent(raw, sign(raw), NOON, {})).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(recordPassFastEvent(raw, sign(raw), NOON, { PASSFAST_WEBHOOK_SECRET: "short" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(recordPassFastEvent(raw, sign(raw), NOON, { PASSFAST_WEBHOOK_SECRET: SECRET, PRODUCTION_ENVIRONMENT: "loynara-production" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("the route answers 200 for a good event without echoing anything, 401 for a bad signature, 413 for a large body, 404 without the secret", async () => {
    const s = await shop(); const c = await customer(s);
    vi.stubEnv("PASSFAST_WEBHOOK_SECRET", SECRET);
    try {
      const raw = eventBody(c.passId, "device.unregistered", new Date());
      const post = (body: string, signature: string) => POST(new Request("http://localhost:3000/api/wallet/passfast-events", { method: "POST", body, headers: { "x-webhook-signature": signature, "x-forwarded-for": "203.0.113.9" } }));
      const ok = await post(raw, sign(raw));
      expect(ok.status).toBe(200); expect(await ok.json()).toEqual({ ok: true });
      expect((await post(raw, sign(raw, "wrong-wrong-wrong-wrong"))).status).toBe(401);
      expect((await post("x".repeat(9000), sign("x".repeat(9000)))).status).toBe(413);
      vi.stubEnv("PASSFAST_WEBHOOK_SECRET", "");
      expect((await post(raw, sign(raw))).status).toBe(404);
    } finally { vi.unstubAllEnvs(); }
  });
});

describe("removed cards", () => {
  async function removalSetup() {
    const s = await shop(); const c = await customer(s); const d = await customer(s);
    const { id } = await go(s); await drain(id, s.tenantId, fake().send);
    const sentAt = T("2026-10-22T10:00:00Z");
    await pool.query("UPDATE wallet_message_recipients SET sent_at = $2 WHERE message_id = $1", [id, sentAt]);
    return { s, c, d, id, sentAt };
  }
  const removal = (passId: string, at: Date) => pool.query("INSERT INTO wallet_pass_events (pass_id, tenant_id, event, event_at) SELECT id, tenant_id, 'device.unregistered', $2 FROM wallet_passes WHERE id = $1", [passId, at]);
  const report = async (s: Shop) => (await walletMessageOverview({ actorUserId: s.owner, programSlug: s.slug }, NOON)).history[0] as unknown as { removed: number; warn: boolean };

  it("counts unregistrations from the send until 48 hours after it, inclusive, and each card once", async () => {
    const { s, c, d, sentAt } = await removalSetup();
    const h = (hours: number, seconds = 0) => new Date(sentAt.getTime() + hours * 3_600_000 + seconds * 1000);
    await removal(c.passId, h(0, -1));      // before the send: not caused by it
    expect((await report(s)).removed).toBe(0);
    await removal(c.passId, h(0));          // at the send
    await removal(c.passId, h(1));          // the same card again
    await removal(d.passId, h(48, 1));      // one second too late
    expect((await report(s)).removed).toBe(1);
    await removal(d.passId, h(48));         // exactly 48 hours
    expect((await report(s)).removed).toBe(2);
  });

  it("warns above the threshold only: 5 percent by default, configurable, and reports it per shop for the operator", async () => {
    expect(removalWarning(1, 20, {})).toBe(false); // exactly 5 percent
    expect(removalWarning(2, 20, {})).toBe(true);
    expect(removalWarning(0, 0, {})).toBe(false);
    expect(removalWarning(2, 20, { WALLET_REMOVAL_WARNING_PERCENT: "10" })).toBe(false);
    expect(removalWarning(3, 20, { WALLET_REMOVAL_WARNING_PERCENT: "10" })).toBe(true);
    expect(removalWarning(1, 20, { WALLET_REMOVAL_WARNING_PERCENT: "nonsense" })).toBe(false);
    const { s, c, sentAt } = await removalSetup(); // 2 recipients: one removal is 50 percent
    await removal(c.passId, sentAt);
    expect(await report(s)).toMatchObject({ removed: 1, warn: true });
    expect((await walletMessageStats()).get(s.programId)).toMatchObject({ messages: 1, sent: 2, removed: 1, warn: true });
  });

  it("an unregistered card gets no more messages until its device registers it again", async () => {
    const s = await shop(); const c = await customer(s); await customer(s);
    await removal(c.passId, T("2026-10-22T09:00:00Z"));
    expect((await walletMessageOverview({ actorUserId: s.owner, programSlug: s.slug }, NOON)).reach).toBe(1);
    await pool.query("INSERT INTO wallet_pass_events (pass_id, tenant_id, event, event_at) VALUES ($1, $2, 'device.registered', $3)", [c.passId, s.tenantId, T("2026-10-22T09:30:00Z")]);
    expect((await walletMessageOverview({ actorUserId: s.owner, programSlug: s.slug }, NOON)).reach).toBe(2);
  });

  it("a card removed between queueing and sending is skipped, not sent", async () => {
    const s = await shop(); await customer(s); const late = await customer(s);
    const { id } = await go(s);
    await removal(late.passId, T("2026-10-22T10:05:00Z"));
    const { calls, send } = fake();
    await drain(id, s.tenantId, send);
    expect(calls.map(call => call.objectId)).not.toContain(`passfast:${late.passId}`);
    expect((await pool.query("SELECT reason FROM wallet_message_recipients WHERE message_id = $1 AND pass_id = $2", [id, late.passId])).rows[0]).toEqual({ reason: "unreachable" });
  });
});

describe("review fixes", () => {
  it("W-1: matches the Apple row by the serial in its object id when the card's Google pass came first", async () => {
    const s = await shop(); const card = await enroll({ slug: s.slug, acceptedTerms: true });
    const googleId = randomUUID(), appleId = randomUUID(), objectId = `passfast:${googleId}:${"a".repeat(64)}`;
    await pool.query("INSERT INTO wallet_passes (id, tenant_id, membership_id, provider, provider_object_id, status) VALUES ($1,$2,$3,'google',$4,'created'), ($5,$2,$3,'apple',$4,'created')",
      [googleId, s.tenantId, card.id, objectId, appleId]);
    const raw = eventBody(googleId, "device.unregistered", NOON); // PassFast reports the shared serial
    expect(await hook(raw, sign(raw), NOON)).toEqual({ recorded: true });
    expect((await events()).map(row => row.pass_id)).toEqual([appleId]);
  });

  it("W-2: a refresh carries the newest message that may have reached the device, never an older one", async () => {
    const s = await shop(); const c = await customer(s);
    const first = await go(s, NOON, "Erste Nachricht");
    await drain(first.id, s.tenantId, fake().send);
    const message = async () => { const snapshot = await walletCardSnapshot(c.id); if (!snapshot.open) throw new Error("open"); return snapshot.pass.message; };
    expect(await message()).toBe("Erste Nachricht");
    const second = await go(s, T("2026-10-22T11:00:00Z"), "Zweite Nachricht");
    expect(await message()).toBe("Erste Nachricht"); // queued, never tried: cannot be on the device yet
    const state = (status: string, attempts: number, reason: string | null = null) => pool.query("UPDATE wallet_message_recipients SET status = $2, attempts = $3, reason = $4 WHERE message_id = $1", [second.id, status, attempts, reason]);
    await state("sending", 1);
    expect(await message()).toBe("Zweite Nachricht"); // a refresh while M2 is in flight
    await state("queued", 1, "retry");
    expect(await message()).toBe("Zweite Nachricht"); // M2 timed out but PassFast may have applied it
    await state("failed", 1, "uncertain");
    expect(await message()).toBe("Zweite Nachricht");
    await state("failed", 3, "provider");
    expect(await message()).toBe("Erste Nachricht");
  });
});

describe("Google Wallet messages (ENG-054)", () => {
  afterEach(() => vi.unstubAllEnvs());
  /** A card holding a live Google Direct pass, optionally also an Apple pass. Consent is the same per-card log. */
  async function googleCustomer(s: Shop, consent = true, apple = false) {
    const card = apple ? await customer(s, false) : { ...await enroll({ slug: s.slug, acceptedTerms: true }), passId: null };
    const { rows: [m] } = await pool.query("SELECT scan_code FROM memberships WHERE id = $1", [card.id]);
    const googlePassId = randomUUID();
    await pool.query("INSERT INTO wallet_passes (id, tenant_id, membership_id, provider, provider_object_id, credential_hash, status) VALUES ($1,$2,$3,'google',$4,$5,'created')",
      [googlePassId, s.tenantId, card.id, `3388000000022123456.loynara_${googlePassId}_${"0".repeat(64)}`, credentialHash(m.scan_code)]);
    if (consent) { const flag = process.env.GOOGLE_WALLET_MARKETING_MESSAGES_ENABLED; vi.stubEnv("GOOGLE_WALLET_MARKETING_MESSAGES_ENABLED", "true"); await setWalletConsent(card.cardToken, true); vi.stubEnv("GOOGLE_WALLET_MARKETING_MESSAGES_ENABLED", flag); }
    return { ...card, googlePassId };
  }
  const fakeGoogle = (result: "added" | "present" | "limited" = "added") => {
    const calls: Array<Parameters<WalletMessageGoogleSend>[0]> = [];
    const googleSend: WalletMessageGoogleSend = async call => { calls.push(call); return result; };
    return { calls, googleSend };
  };
  async function drainAll(messageId: string, tenantId: string, deps: { send: WalletMessageSend; googleSend: WalletMessageGoogleSend }, now = NOON) {
    for (let i = 0; i < 20; i++) if ((await deliverWalletMessage({ id: randomUUID(), tenantId, payload: { messageId } }, { ...deps, now: () => now })).status !== "deferred") return;
  }

  it("with the marketing flag off nothing changes, even with the service flag on: a Google pass is not offered consent, not counted and never sent to", async () => {
    vi.stubEnv("GOOGLE_WALLET_SERVICE_MESSAGES_ENABLED", "true");
    const s = await shop(); const g = await googleCustomer(s, false); const both = await googleCustomer(s, false, true);
    expect((await getWalletConsent(g.cardToken)).available).toBe(false);
    await expect(setWalletConsent(g.cardToken, true)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await setWalletConsent(both.cardToken, true); // through its Apple pass
    expect((await walletMessageOverview({ actorUserId: s.owner, programSlug: s.slug }, NOON)).reach).toBe(1);
    const apple = fake(), google = fakeGoogle();
    const { id, audience } = await go(s);
    expect(audience).toBe(1);
    await drainAll(id, s.tenantId, { send: apple.send, googleSend: google.googleSend });
    expect(apple.calls.map(c => c.objectId)).toEqual([`passfast:${both.passId}`]);
    expect(google.calls).toEqual([]);
  });

  it("with the flag on a consented Google holder gets the message with notification, once, and the Apple path is unchanged", async () => {
    vi.stubEnv("GOOGLE_WALLET_MARKETING_MESSAGES_ENABLED", "true");
    const s = await shop(); const g = await googleCustomer(s); await googleCustomer(s, false); const both = await googleCustomer(s, true, true);
    expect(await getWalletConsent(g.cardToken)).toMatchObject({ available: true, granted: true });
    const apple = fake(), google = fakeGoogle();
    const { id, audience } = await go(s);
    expect(audience).toBe(3); // g's Google pass, both's Apple and Google pass; the unconsented card none
    expect(await walletMessageOverview({ actorUserId: s.owner, programSlug: s.slug }, T("2026-10-23T10:00:00Z"))).toMatchObject({ reach: 2 }); // two customers, three passes
    await drainAll(id, s.tenantId, { send: apple.send, googleSend: google.googleSend });
    expect(apple.calls.map(c => c.objectId)).toEqual([`passfast:${both.passId}`]);
    expect(google.calls.map(c => c.passId).sort()).toEqual([g.googlePassId, both.googlePassId].sort());
    expect(google.calls[0].message).toMatchObject({ header: "Synthetic Café", body: TEXT, messageType: "TEXT_AND_NOTIFY" });
    expect(google.calls[0].message.id).toMatch(/^owner_[0-9a-f]{64}$/);
    expect(new Set(google.calls.map(c => c.message.id)).size).toBe(2);
    expect((await pool.query("SELECT sent_count FROM wallet_messages WHERE id = $1", [id])).rows[0].sent_count).toBe(3);
    // Running the job again sends nothing.
    await drainAll(id, s.tenantId, { send: apple.send, googleSend: google.googleSend });
    expect(google.calls).toHaveLength(2);
  });

  it("a card with an Apple and a Google pass uses one of its 2 weekly messages per message, not two", async () => {
    vi.stubEnv("GOOGLE_WALLET_MARKETING_MESSAGES_ENABLED", "true");
    const s = await shop(); const both = await googleCustomer(s, true, true);
    const deps = { send: fake().send, googleSend: fakeGoogle().googleSend };
    await drainAll((await go(s, T("2026-10-20T10:00:00Z"))).id, s.tenantId, deps, T("2026-10-20T10:00:00Z"));
    expect((await walletMessageOverview({ actorUserId: s.owner, programSlug: s.slug }, T("2026-10-21T10:00:00Z"))).reach).toBe(1); // one customer with room left (counting rows would give 0)
    await drainAll((await go(s, T("2026-10-21T10:00:00Z"))).id, s.tenantId, deps, T("2026-10-21T10:00:00Z"));
    expect((await walletMessageOverview({ actorUserId: s.owner, programSlug: s.slug }, T("2026-10-22T10:00:00Z"))).reach).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM wallet_message_recipients WHERE membership_id = $1 AND status = 'sent'", [both.id])).rows[0].n).toBe(4);
  });

  it("a retry reuses the same Google message id; Google's notification limit skips the card without a retry", async () => {
    vi.stubEnv("GOOGLE_WALLET_MARKETING_MESSAGES_ENABLED", "true");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = await shop(); await googleCustomer(s);
    const ids: string[] = [];
    let first = true;
    const flaky: WalletMessageGoogleSend = async call => { ids.push(call.message.id); if (first) { first = false; throw new Error("synthetic outage"); } return "added"; };
    const { id } = await go(s);
    for (let i = 0; i < 3; i++) {
      await pool.query("UPDATE wallet_message_recipients SET retry_at = now() WHERE status = 'queued'");
      await deliverWalletMessage({ id: randomUUID(), tenantId: s.tenantId, payload: { messageId: id } }, { send: fake().send, googleSend: flaky, now: () => NOON });
    }
    expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
    expect((await recipientStatuses(id))[0]).toEqual({ status: "sent", reason: null });

    const t = await shop("Other café"); await googleCustomer(t);
    const limited = fakeGoogle("limited");
    const second = await go(t);
    await drainAll(second.id, t.tenantId, { send: fake().send, googleSend: limited.googleSend });
    expect(limited.calls).toHaveLength(1);
    expect((await recipientStatuses(second.id))[0]).toEqual({ status: "skipped", reason: "google_limit" });
  });

  it("the removal warning compares Apple removals with Apple sends only: Google sends do not dilute it", async () => {
    vi.stubEnv("GOOGLE_WALLET_MARKETING_MESSAGES_ENABLED", "true");
    const s = await shop(); const a = await customer(s);
    for (let i = 0; i < 20; i++) await googleCustomer(s);
    const { id } = await go(s);
    await drainAll(id, s.tenantId, { send: fake().send, googleSend: fakeGoogle().googleSend });
    await pool.query("INSERT INTO wallet_pass_events (pass_id, tenant_id, event, event_at) SELECT id, tenant_id, 'device.unregistered', now() FROM wallet_passes WHERE id = $1", [a.passId]);
    // 1 removal of 1 Apple send (100 %), not 1 of 21 sends (4.8 %, under the 5 % threshold).
    expect((await walletMessageOverview({ actorUserId: s.owner, programSlug: s.slug }, NOON)).history[0]).toMatchObject({ sent: 21, removed: 1, warn: true });
    expect((await walletMessageStats()).get(s.programId)).toMatchObject({ sent: 21, removed: 1, warn: true });
  });

  it("switching the flag off stops Google deliveries already queued; Apple recipients still get theirs", async () => {
    vi.stubEnv("GOOGLE_WALLET_MARKETING_MESSAGES_ENABLED", "true");
    const s = await shop(); const both = await googleCustomer(s, true, true);
    const { id } = await go(s);
    vi.stubEnv("GOOGLE_WALLET_MARKETING_MESSAGES_ENABLED", "false");
    const apple = fake(), google = fakeGoogle();
    await drainAll(id, s.tenantId, { send: apple.send, googleSend: google.googleSend });
    expect(google.calls).toEqual([]);
    expect(apple.calls.map(c => c.objectId)).toEqual([`passfast:${both.passId}`]);
    expect((await pool.query("SELECT reason FROM wallet_message_recipients WHERE pass_id = $1", [both.googlePassId])).rows[0].reason).toBe("google_off");
  });
});
