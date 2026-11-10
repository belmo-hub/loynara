import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { POST as enrollRoute } from "@/app/api/enroll/route";
import { createMerchant, enroll } from "./product";
import { appleFixture, withEnv } from "./wallet/test-support";
import { CONSENT_TEXT_VERSION, CONSENT_TEXTS, JOIN_CONSENT_TEXT_VERSION, joinConsentText } from "./wallet-message-rules";
import { getWalletConsent, setWalletConsent } from "./wallet-messages";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

const origin = "http://localhost:3000";
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests, rate_limits CASCADE'); });
afterEach(() => vi.unstubAllEnvs());
let apple: ReturnType<typeof appleFixture>;
beforeAll(() => { apple = appleFixture(); });
afterAll(async () => { apple.cleanup(); await pool.end(); });
const withApple = <T>(run: () => Promise<T>) => withEnv(apple.env, run);

async function shop(locale: "de" | "fr" = "de") {
  const owner = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [owner, "Join consent fixture", `${owner}@example.test`]);
  return createMerchant({ userId: owner, businessName: "Tick Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale, currency: "EUR", programName: "Testkarte", programType: "stamp", rulesText: "Eine Einheit pro Kauf.", rewardTitle: "Kaffee", rewardCost: 5 });
}
const consents = async () => (await pool.query("SELECT membership_id, text_version, withdrawn_at FROM wallet_message_consents")).rows;
const cards = async () => (await pool.query("SELECT count(*)::int AS n FROM memberships")).rows[0].n;

describe("Wallet-message consent on the join page (ENG-173)", () => {
  it("keeps a version for each text, and the join text says „auf meiner Karte“ without „hier“", () => {
    expect(Object.keys(CONSENT_TEXTS)).toEqual([CONSENT_TEXT_VERSION, JOIN_CONSENT_TEXT_VERSION, "wallet-consent-demo-2026-11-09-v1"]);
    expect(joinConsentText("Tick Café", "Mitte")).toBe("Ja, Tick Café, Mitte, darf mir Angebote, Neuigkeiten und Erinnerungen als Nachricht auf meiner Wallet-Karte schicken (höchstens 2 pro Woche). Das ist freiwillig und für die Karte nicht nötig. Ich kann es jederzeit auf meiner Karte abschalten. Mehr in den Datenschutzhinweisen.");
  });
  it("creates the card with no tick and no consent row", async () => {
    const { programSlug } = await shop();
    await enroll({ slug: programSlug, acceptedTerms: true });
    expect(await cards()).toBe(1);
    expect(await consents()).toEqual([]);
  });
  it("writes one row for the tick, through the route, and the card can switch it off without a pass", async () => {
    await withApple(async () => {
    const { programSlug } = await shop();
    const response = await enrollRoute(new Request(`${origin}/api/enroll`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ slug: programSlug, acceptedTerms: true, walletConsentVersion: JOIN_CONSENT_TEXT_VERSION }) }));
    expect(response.status).toBe(201);
    const { cardToken, cardLocator } = await response.json();
    // The join keeps its "already shown" flags under the card number, never the private link (F-2).
    expect(cardLocator).toMatch(/^K-[A-Z2-9]{6}$/);
    expect(await consents()).toMatchObject([{ text_version: JOIN_CONSENT_TEXT_VERSION, withdrawn_at: null }]);
    expect(await getWalletConsent(cardToken)).toMatchObject({ available: true, granted: true, givenAt: expect.any(String), shop: "Tick Café" });
    await setWalletConsent(cardToken, false);
    expect((await consents())[0].withdrawn_at).not.toBeNull();
    });
  });
  it("writes it in the card's transaction: a failed consent row leaves no card", async () => {
    await withApple(async () => {
    const { programSlug } = await shop();
    await pool.query("ALTER TABLE wallet_message_consents ADD CONSTRAINT eng_173_refuse CHECK (false) NOT VALID");
    try {
      await expect(enroll({ slug: programSlug, acceptedTerms: true, walletConsentVersion: JOIN_CONSENT_TEXT_VERSION })).rejects.toThrow();
    } finally { await pool.query("ALTER TABLE wallet_message_consents DROP CONSTRAINT eng_173_refuse"); }
    expect(await cards()).toBe(0);
    });
  });
  it("refuses a stale or unknown version, and creates nothing", async () => {
    await withApple(async () => {
    const { programSlug } = await shop();
    for (const walletConsentVersion of [CONSENT_TEXT_VERSION, "wallet-consent-join-2026-01-01-v1", ""]) {
      await expect(enroll({ slug: programSlug, acceptedTerms: true, walletConsentVersion })).rejects.toMatchObject({ code: "CONSENT_TEXT_CHANGED" });
    }
    expect(await cards()).toBe(0);
    expect(await consents()).toEqual([]);
    // After the reload the box is unticked: the customer gets the card without it, and no consent.
    await enroll({ slug: programSlug, acceptedTerms: true });
    expect(await cards()).toBe(1);
    expect(await consents()).toEqual([]);
    });
  });
  it("refuses the tick where the location has no Apple Wallet, and the card still comes without it", async () => {
    const { programSlug } = await shop();
    await withEnv({ APPLE_WALLET_ENABLED: "false", PASSFAST_ENABLED: undefined }, async () => {
      await expect(enroll({ slug: programSlug, acceptedTerms: true, walletConsentVersion: JOIN_CONSENT_TEXT_VERSION })).rejects.toMatchObject({ code: "CONSENT_TEXT_CHANGED" });
      expect(await cards()).toBe(0);
      await enroll({ slug: programSlug, acceptedTerms: true });
    });
    expect(await cards()).toBe(1);
    expect(await consents()).toEqual([]);
  });
  it("refuses the tick for a French shop and while the surface is off", async () => {
    await withApple(async () => {
    const french = await shop("fr");
    await expect(enroll({ slug: french.programSlug, acceptedTerms: true, walletConsentVersion: JOIN_CONSENT_TEXT_VERSION })).rejects.toMatchObject({ code: "CONSENT_TEXT_CHANGED" });
    const german = await shop();
    vi.stubEnv("PRODUCTION_ENVIRONMENT", "loynara-production");
    vi.stubEnv("WALLET_MESSAGES_ENABLED", "");
    await expect(enroll({ slug: german.programSlug, acceptedTerms: true, walletConsentVersion: JOIN_CONSENT_TEXT_VERSION })).rejects.toMatchObject({ code: "CONSENT_TEXT_CHANGED" });
    expect(await cards()).toBe(0);
    });
  });
});
