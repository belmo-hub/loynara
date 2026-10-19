import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type APIRequestContext, type Browser } from "@playwright/test";
import pg from "pg";
import { verificationTokenForChallenge } from "../src/lib/contact-token";

// ENG-007: the e-mail offer on the card after the first stamp, on a 375 px phone. Needs local promotional mail (Mailpit
// mode) and the dev server's BETTER_AUTH_SECRET in this process, to open the confirmation link without a worker.
test.use({ viewport: { width: 375, height: 812 } });

async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Synthetic local database required");
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try { return (await client.query<T>(text, params)).rows; } finally { await client.end(); }
}

async function shop(baseURL: string) {
  const owner = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL).origin } });
  const email = `offer-owner-${randomUUID()}@example.test`;
  expect((await owner.post("/api/auth/sign-up/email", { data: { name: "Synthetic offer owner", email, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  const onboard = await owner.post("/api/merchant/onboard", { data: {
    businessName: "Synthetische Kaffeebar", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
    programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Besuch.", rewardTitle: "Gratiskaffee", rewardCost: 8,
  } });
  expect(onboard.status()).toBe(201);
  return { owner, programSlug: (await onboard.json() as { programSlug: string }).programSlug };
}

async function stampedCard(browser: Browser, baseURL: string, owner: APIRequestContext, programSlug: string) {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL).origin } });
  const enrolled = await context.request.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true } });
  expect(enrolled.status()).toBe(201);
  const { cardToken } = await enrolled.json() as { cardToken: string };
  const card = await (await context.request.get(`/api/card/${cardToken}`)).json() as { scanCode: string };
  const member = await (await owner.get(`/api/cashier/lookup?code=${encodeURIComponent(card.scanCode)}`)).json() as { membershipId: string };
  expect((await owner.post("/api/cashier/award", { data: { membershipId: member.membershipId, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() } })).status()).toBe(200);
  return { context, cardToken, membershipId: member.membershipId };
}

const noSideScroll = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("offer after the first stamp: address + unticked consent, sent, confirmed by the mail link, later Abbestellen", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const { owner, programSlug } = await shop(baseURL!);
  const guest = await stampedCard(browser, baseURL!, owner, programSlug);
  try {
    const page = await guest.context.newPage();
    await page.goto(`/card/${guest.cardToken}`);
    const offer = page.getByRole("region", { name: "Erinnerungen per E-Mail?" });
    await expect(offer).toBeVisible();
    // Under the card face: the code stays on top, the offer comes before Wallet and the other panels.
    const qr = await page.locator(".customer-qr img").boundingBox(), box = await offer.boundingBox();
    expect(box!.y).toBeGreaterThan(qr!.y + qr!.height);
    await expect(offer.getByText("Mit dieser Adresse finde ich meine Karte wieder, falls ich den Link verliere. Sie wird nur dafür genutzt, nicht für Werbung.")).toBeVisible();
    const consent = offer.getByRole("checkbox");
    await expect(consent).toHaveCount(1);
    await expect(consent).not.toBeChecked();
    await expect(offer.getByText(/^Ja, Synthetische Kaffeebar, darf mir Angebote, Neuigkeiten und Erinnerungen per E-Mail schicken\./)).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);

    await offer.getByRole("button", { name: "Bestätigungslink schicken" }).click();
    await expect(offer.getByText("Bitte gib eine gültige E-Mail-Adresse ein.")).toBeVisible();
    const email = `gast-${randomUUID()}@example.test`;
    await offer.getByRole("textbox", { name: "E-Mail-Adresse" }).fill(email);
    await consent.check();
    await offer.getByRole("button", { name: "Bestätigungslink schicken" }).click();
    const sent = page.getByRole("region", { name: "Fast geschafft." });
    await expect(sent).toContainText(`Wir haben dir einen Link an ${email} geschickt. Erst wenn du ihn anklickst, bekommst du Nachrichten.`);
    expect(await sql("SELECT granted FROM consent_events WHERE membership_id=$1", [guest.membershipId])).toEqual([]);
    await page.reload();
    await expect(page.getByRole("region", { name: "Fast geschafft." })).toContainText("Wir haben dir einen Link geschickt.");

    const [challenge] = await sql<{ id: string; marketing: boolean }>("SELECT id, marketing FROM contact_verification_challenges WHERE membership_id=$1", [guest.membershipId]);
    expect(challenge.marketing).toBe(true);
    const confirm = await guest.context.newPage();
    await confirm.goto(`/verify-email#token=${verificationTokenForChallenge(challenge.id)}`);
    expect(await sql("SELECT granted FROM consent_events WHERE membership_id=$1", [guest.membershipId])).toEqual([]);
    await confirm.getByRole("button", { name: "E-Mail-Adresse bestätigen" }).click();
    await expect(confirm.getByRole("heading", { name: "Du bist dabei!" })).toBeVisible();
    await expect(confirm.getByText("Ab jetzt bekommst du von Synthetische Kaffeebar Angebote, Neuigkeiten und Erinnerungen per E-Mail.", { exact: false })).toBeVisible();
    await expect(confirm.locator(`a[href*="/card/"]`)).toHaveCount(0);
    expect(await sql("SELECT granted, source FROM consent_events WHERE membership_id=$1", [guest.membershipId])).toEqual([{ granted: true, source: "double_opt_in" }]);

    await page.reload();
    await expect(page.getByRole("region", { name: "Erinnerungen per E-Mail?" })).toHaveCount(0);
    const later = page.getByRole("region", { name: "E-Mail", exact: true });
    await expect(later).toContainText("Adresse bestätigt");
    await expect(later).toContainText("Angebote, Neuigkeiten, Erinnerungen · an");
    await later.getByRole("button", { name: "Abbestellen" }).click();
    await expect(later).toContainText("Angebote, Neuigkeiten, Erinnerungen · aus");
    await expect(later.getByText("Abbestellt. Deine Adresse zum Wiederfinden der Karte bleibt.")).toBeVisible();
    expect(await noSideScroll(page)).toBe(true);
  } finally { await guest.context.close(); await owner.dispose(); }
});

test("\"Nein, danke\" hides the offer and it never returns by itself; the card works the same", async ({ browser, baseURL }) => {
  const { owner, programSlug } = await shop(baseURL!);
  const guest = await stampedCard(browser, baseURL!, owner, programSlug);
  try {
    const page = await guest.context.newPage();
    await page.goto(`/card/${guest.cardToken}`);
    const offer = page.getByRole("region", { name: "Erinnerungen per E-Mail?" });
    await offer.getByRole("button", { name: "Nein, danke" }).click();
    await expect(offer).toHaveCount(0);
    await expect(page.locator(".customer-qr img")).toBeVisible();
    await expect.poll(() => sql("SELECT granted FROM consent_events WHERE membership_id=$1", [guest.membershipId])).toEqual([{ granted: false }]);
    expect((await owner.post("/api/cashier/award", { data: { membershipId: guest.membershipId, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() } })).status()).toBe(200);
    await page.reload();
    await expect(page.locator(".customer-qr img")).toBeVisible();
    await expect(page.getByRole("region", { name: "Erinnerungen per E-Mail?" })).toHaveCount(0);
    // One quiet row with the panels below instead; setting it up stays possible by hand.
    const row = page.getByRole("region", { name: "E-Mail", exact: true });
    await expect(row).toContainText("Erinnerungen per E-Mail");
    await row.getByRole("button", { name: "Einrichten" }).click();
    await expect(page.getByRole("region", { name: "Erinnerungen per E-Mail?" }).getByRole("checkbox")).not.toBeChecked();
    expect(await noSideScroll(page)).toBe(true);
  } finally { await guest.context.close(); await owner.dispose(); }
});
