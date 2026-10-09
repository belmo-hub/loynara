import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { merchantWithTag, pathOf, pendingOf, sql } from "./nfc-support";

async function inboxLink(email: string, subject: string) {
  let link = "";
  await expect.poll(async () => {
    const list = await (await fetch("http://127.0.0.1:8026/api/v1/messages")).json() as { messages: Array<{ ID: string; Subject: string; To: Array<{ Address: string }> }> };
    const message = list.messages.find(m => m.Subject.includes(subject) && m.To.some(t=>t.Address===email));
    if (!message) return false;
    const body = await (await fetch(`http://127.0.0.1:8026/api/v1/message/${message.ID}`)).json() as { Text: string };
    link = body.Text.match(/http:\/\/localhost:3059\/(?:verify-email|recover\/confirm)#token=[A-Za-z0-9_-]+/)?.[0] ?? "";
    return Boolean(link);
  }, { timeout: 25_000 }).toBe(true);
  return link;
}

test("first NFC visit verifies recovery email before any award; a returning and recovered browser retains the original card", async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const m = await merchantWithTag(baseURL!);
  const customer = await browser.newContext({ baseURL });
  const email = `recovery-${randomUUID()}@example.test`;
  try {
    const page = await customer.newPage();
    await page.goto(pathOf(m.nextUrl()));
    await page.getByRole("link", { name: "Karte erstellen", exact: true }).click();
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: /Meine Karte erstellen/ }).click();
    await expect(page.getByRole("heading", { name: "Vor dem ersten Stempel: Karte sichern", exact: true })).toBeVisible();
    const [original] = await sql<{ id: string; card_locator: string; balance: number; card_token: string }>("SELECT id, card_locator, balance, card_token FROM memberships WHERE program_id=$1", [m.me.programId]);
    expect(original.balance).toBe(0);
    expect(await pendingOf(m.cashier)).toHaveLength(0);
    await page.getByLabel("E-Mail-Adresse", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Bestätigungslink senden", exact: true }).click();
    expect(await sql("SELECT id FROM ledger_entries WHERE membership_id=$1", [original.id])).toHaveLength(0);
    const verifyPage = await customer.newPage();
    await verifyPage.goto(await inboxLink(email, "bestätigen"));
    await expect(verifyPage.getByRole("heading", { name: "E-Mail-Adresse bestätigen", exact: true })).toBeVisible();
    await verifyPage.getByRole("button", { name: "E-Mail-Adresse bestätigen", exact: true }).click();
    await expect(verifyPage.getByRole("heading", { name: "E-Mail bestätigt.", exact: true })).toBeVisible();
    // Force the refresh-before-button race from the focused review.
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("heading", { name: "Warte auf das Team", exact: true })).toBeVisible({ timeout: 25_000 });
    let pending = await pendingOf(m.cashier);
    expect(pending).toHaveLength(1); expect(pending[0].cardLocator).toBe(`K-${original.card_locator}`);
    expect((await m.cashier.post(`/api/cashier/tap/${pending[0].id}/confirm`)).status()).toBe(200);
    await expect(page.getByText("Aktueller Stand: 1 Stempel", { exact: true })).toBeVisible();
    await page.goto(pathOf(m.nextUrl()));
    await expect(page.getByRole("heading", { name: "Warte auf das Team", exact: true })).toBeVisible();
    pending = await pendingOf(m.cashier);
    expect(pending[0].cardLocator).toBe(`K-${original.card_locator}`);
    expect((await m.cashier.post(`/api/cashier/tap/${pending[0].id}/cancel`)).status()).toBe(200);
    await customer.clearCookies();
    await page.goto("/recover");
    await page.getByLabel("Bestätigte E-Mail-Adresse", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Link anfordern", exact: true }).click();
    await page.goto(await inboxLink(email, "wiederfinden"));
    await page.getByRole("button", { name: "Meine Karten anzeigen", exact: true }).click();
    await page.getByRole("button", { name: "Diese Karte wiederherstellen", exact: true }).click();
    await expect(page.getByText(`K-${original.card_locator}`, { exact: true }).first()).toBeVisible();
    const [restored] = await sql<{ id: string; card_locator: string; balance: number; card_token: string }>("SELECT id, card_locator, balance, card_token FROM memberships WHERE program_id=$1", [m.me.programId]);
    expect(restored.id).toBe(original.id); expect(restored.card_locator).toBe(original.card_locator); expect(restored.balance).toBe(1); expect(restored.card_token).not.toBe(original.card_token);
    expect((await sql("SELECT delta FROM ledger_entries WHERE membership_id=$1 AND kind='award'", [original.id])).map(r=>r.delta)).toEqual([1]);
    expect(await sql("SELECT id FROM consent_events WHERE membership_id=$1 AND granted", [original.id])).toHaveLength(0);
  } finally { await customer.close(); await m.close(); }
});
