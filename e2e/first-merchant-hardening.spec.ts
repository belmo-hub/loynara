import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * First-merchant launch hardening: the counter QR must not hand a returning guest a silent second card, the cashier must
 * move safely to the next guest, the cashier never sees the raw scan code, the offline fallback is not a normal online
 * choice, and the guest's card catches up with a booking when they look at it again.
 */

async function merchant(url: string, name: string) {
  const owner = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  expect((await owner.post("/api/auth/sign-up/email", { data: { name: "Synthetic hardening owner", email: `hardening-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  const setup = await owner.post("/api/merchant/onboard", { data: {
    businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
    programName: `${name} Karte`, programType: "stamp", rulesText: "Ein Stempel pro bestätigtem Besuch.", rewardTitle: "Pizza gratis", rewardCost: 10,
  } });
  expect(setup.status()).toBe(201);
  const { programSlug } = await setup.json() as { programSlug: string };
  return { owner, programSlug };
}

async function guestCard(url: string, programSlug: string) {
  const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  try {
    const joined = await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true } });
    expect(joined.status()).toBe(201);
    const { cardToken } = await joined.json() as { cardToken: string };
    const card = await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string; cardLocator: string };
    return { cardToken, ...card };
  } finally { await guest.dispose(); }
}

async function balanceOf(url: string, cardToken: string) {
  const reader = await apiRequest.newContext({ baseURL: url });
  try { return ((await (await reader.get(`/api/card/${encodeURIComponent(cardToken)}`)).json()) as { balance: number }).balance; }
  finally { await reader.dispose(); }
}

async function awardViaApi(owner: APIRequestContext, scanCode: string) {
  const lookup = await owner.get(`/api/cashier/lookup?code=${encodeURIComponent(scanCode)}`);
  expect(lookup.status()).toBe(200);
  const { membershipId } = await lookup.json() as { membershipId: string };
  const award = await owner.post("/api/cashier/award", { data: { membershipId, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() } });
  expect(award.status()).toBe(200);
  return membershipId;
}

async function openCard(page: Page, code: string) {
  await page.getByRole("button", { name: "Andere Karte" }).click({ timeout: 1_000 }).catch(() => {});
  await page.getByLabel("Kartennummer oder Kartencode").fill(code);
  await page.getByRole("button", { name: "Prüfen", exact: true }).click();
  await expect(page.locator(".balance-display")).toBeVisible();
}

test("a returning guest is offered the saved card instead of a silent second card", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const shop = await merchant(url, "Synthetic Rückkehr Pizzeria");
  const phone = await browser.newContext({ baseURL: url });
  try {
    const page = await phone.newPage();
    const enrolPosts: string[] = [];
    page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/enroll") enrolPosts.push(request.postData() ?? ""); });

    // First visit: the normal join creates the card.
    await page.goto(`/join/${encodeURIComponent(shop.programSlug)}`);
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Meine Karte erstellen" }).click();
    await expect.poll(() => new URL(page.url()).pathname.startsWith("/card/")).toBe(true);
    const firstPath = new URL(page.url()).pathname;
    const locator = await page.locator(".customer-card-number strong").innerText();
    expect(locator).toMatch(/^K-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    await expect(page.getByRole("heading", { name: "So findest du deine Karte wieder" })).toBeVisible();
    await expect(page.locator(".customer-return-steps")).toContainText(`Notiere dir deine Kartennummer ${locator}`);
    await expect(page.locator(".customer-return-steps")).toContainText("nach einer Prüfung einen neuen Kartenlink");
    await expect(page.locator(".customer-return-steps")).toContainText("Im privaten Modus oder nach dem Löschen der Browserdaten klappt das nicht.");
    await expect(page.getByRole("button", { name: "Kartencode anzeigen" })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("sc_");
    expect(enrolPosts).toHaveLength(1);

    // Next visit: scanning the counter QR again offers the existing card; nothing is created.
    await page.goto(`/join/${encodeURIComponent(shop.programSlug)}`);
    await expect(page.getByRole("heading", { name: "Willkommen zurück." })).toBeVisible();
    await expect(page.locator(".join-card-number strong")).toHaveText(locator);
    await expect(page.getByRole("button", { name: "Meine Karte erstellen" })).toHaveCount(0);
    await page.getByRole("link", { name: "Meine Karte öffnen" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(firstPath);
    await expect(page.locator(".customer-card-number strong")).toHaveText(locator);
    expect(enrolPosts).toHaveLength(1);

    // Another card stays possible, but only as a secondary, explicitly confirmed choice.
    await page.goto(`/join/${encodeURIComponent(shop.programSlug)}`);
    await page.getByRole("button", { name: "Ich brauche eine weitere Karte" }).click();
    await expect(page.getByRole("heading", { name: "Weitere Karte erstellen?" })).toBeVisible();
    await expect(page.locator(".join-another-warning")).toContainText(`bleiben auf Karte ${locator} und werden nicht übertragen`);
    await page.getByRole("checkbox", { name: /Programmregeln/ }).check();
    await page.getByRole("button", { name: "Weitere Karte erstellen" }).click();
    await expect(page.getByText("Bitte bestätige, dass du eine zusätzliche Karte möchtest.")).toBeVisible();
    expect(enrolPosts).toHaveLength(1);
    await page.getByRole("checkbox", { name: "Ich möchte trotzdem eine zusätzliche Karte erstellen." }).check();
    await page.getByRole("button", { name: "Weitere Karte erstellen" }).click();
    await expect.poll(() => new URL(page.url()).pathname.startsWith("/card/") && new URL(page.url()).pathname !== firstPath).toBe(true);
    expect(enrolPosts).toHaveLength(2);
    expect(JSON.parse(enrolPosts[1])).toMatchObject({ additionalCard: true });
    const secondLocator = await page.locator(".customer-card-number strong").innerText();
    expect(secondLocator).not.toBe(locator);

    // A closed card is never offered again; the guest sees a plain note and can join normally.
    await page.getByRole("button", { name: "Karte schließen" }).click();
    await page.getByRole("button", { name: "Schließung verbindlich bestätigen" }).click();
    await expect(page.getByRole("heading", { name: "Karte geschlossen." })).toBeVisible();
    await page.goto(`/join/${encodeURIComponent(shop.programSlug)}`);
    await expect(page.getByRole("heading", { name: "Mach deinen Besuch zählbar." })).toBeVisible();
    await expect(page.getByText("die nicht mehr gilt", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Meine Karte erstellen" })).toBeEnabled();

    // A private window (no saved data) simply gets the normal join.
    const privateWindow = await browser.newContext({ baseURL: url });
    try {
      const fresh = await privateWindow.newPage();
      await fresh.goto(`/join/${encodeURIComponent(shop.programSlug)}`);
      await expect(fresh.getByRole("heading", { name: "Mach deinen Besuch zählbar." })).toBeVisible();
      await expect(fresh.getByRole("button", { name: "Meine Karte erstellen" })).toBeEnabled();
    } finally { await privateWindow.close(); }
  } finally { await phone.close(); await shop.owner.dispose(); }
});

test("two tabs of one browser pressing create at the same time make one card", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const shop = await merchant(url, "Synthetic Zwei Tabs Pizzeria");
  const phone = await browser.newContext({ baseURL: url });
  try {
    const posts: string[] = [];
    phone.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/enroll") posts.push(request.url()); });
    // A slow network: the first creation is still on its way when the second tab presses create.
    await phone.route("**/api/enroll", async route => { await new Promise(resolve => setTimeout(resolve, 1_500)); await route.continue(); });
    const [first, second] = [await phone.newPage(), await phone.newPage()];
    for (const tab of [first, second]) {
      await tab.goto(`/join/${encodeURIComponent(shop.programSlug)}`);
      await tab.getByRole("checkbox").first().check();
      await expect(tab.getByRole("button", { name: "Meine Karte erstellen" })).toBeEnabled();
    }
    await Promise.all([first.getByRole("button", { name: "Meine Karte erstellen" }).click(), second.getByRole("button", { name: "Meine Karte erstellen" }).click()]);
    const pages = [first, second];
    await expect.poll(async () => (await Promise.all(pages.map(async tab => new URL(tab.url()).pathname.startsWith("/card/") || await tab.getByRole("heading", { name: "Willkommen zurück." }).isVisible()))).every(Boolean), { timeout: 10_000 }).toBe(true);
    expect(posts).toHaveLength(1);
  } finally { await phone.close(); await shop.owner.dispose(); }
});

test("a card from one programme is never offered on another programme's join page", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const pizza = await merchant(url, "Synthetic Pizza Nord");
  const barber = await merchant(url, "Synthetic Barber Süd");
  const phone = await browser.newContext({ baseURL: url });
  try {
    const page = await phone.newPage();
    await page.goto(`/join/${encodeURIComponent(pizza.programSlug)}`);
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Meine Karte erstellen" }).click();
    await expect.poll(() => new URL(page.url()).pathname.startsWith("/card/")).toBe(true);
    await page.goto(`/join/${encodeURIComponent(barber.programSlug)}`);
    await expect(page.getByRole("heading", { name: "Mach deinen Besuch zählbar." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Willkommen zurück." })).toHaveCount(0);
    await page.goto(`/join/${encodeURIComponent(pizza.programSlug)}`);
    await expect(page.getByRole("heading", { name: "Willkommen zurück." })).toBeVisible();
  } finally { await phone.close(); await pizza.owner.dispose(); await barber.owner.dispose(); }
});

test("after a booking the card closes, shows its number, and the counter returns to the next guest", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const shop = await merchant(url, "Synthetic Kassen Pizzeria");
  const card = await guestCard(url, shop.programSlug);
  const counter = await browser.newContext({ baseURL: url, storageState: await shop.owner.storageState() });
  try {
    const page = await counter.newPage();
    await page.goto("/cashier");
    await page.getByLabel("Kartennummer oder Kartencode").fill(card.scanCode);
    await page.getByRole("button", { name: "Prüfen", exact: true }).click();
    await expect(page.getByRole("heading", { name: card.cardLocator })).toBeVisible();
    // The scan code a handheld scanner typed is not left on screen; the cashier only ever sees the card number.
    await expect(page.locator("body")).not.toContainText("sc_");
    // Online there is no offline fallback on the counter.
    await expect(page.getByRole("region", { name: "Offline-Vergaben" })).toHaveCount(0);
    await expect(page.getByText("Offline-Puffer bereit", { exact: false })).toHaveCount(0);

    await page.getByRole("button", { name: "Vergabe prüfen" }).click();
    const dialog = page.getByRole("dialog", { name: "Vergabe bestätigen?" });
    await expect(dialog).toContainText(`1 Stempel für Karte ${card.cardLocator}.`);
    await expect(dialog).not.toContainText("sc_");
    await expect(page.getByRole("button", { name: "Offline-Vergabe vormerken" })).toHaveCount(0);
    await page.getByRole("button", { name: "Ja, vergeben" }).click();

    const booked = page.locator(".cashier-booked");
    await expect(booked).toContainText(`1 Stempel für ${card.cardLocator} vergeben. Neuer Stand: 1 Stempel.`);
    // Nothing on the previous card is actionable any more.
    await expect(page.getByRole("button", { name: "Vergabe prüfen" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Menge erhöhen" })).toHaveCount(0);
    await expect(page.locator(".balance-display")).toHaveCount(0);
    await expect(booked).not.toContainText("sc_");
    // The next card can be scanned at once; the confirmation hides on its own, keeping the last booking as a note.
    await expect(page.getByRole("heading", { name: "Bereit für die nächste Karte" })).toBeVisible();
    await expect(booked).toHaveCount(0, { timeout: 8_000 });
    await expect(page.locator(".cashier-status")).toContainText(`für ${card.cardLocator} vergeben`);
    expect(await balanceOf(url, card.cardToken)).toBe(1);

    // "Andere Karte" moves on immediately, without waiting.
    await openCard(page, card.scanCode);
    await page.getByRole("button", { name: "Vergabe prüfen" }).click();
    await page.getByRole("button", { name: "Ja, vergeben" }).click();
    await expect(booked).toBeVisible();
    await page.getByRole("button", { name: "Andere Karte" }).click();
    await expect(page.getByRole("button", { name: "Kamera öffnen" })).toBeVisible({ timeout: 1_000 });
    expect(await balanceOf(url, card.cardToken)).toBe(2);

    // A double click on the confirmation books once.
    await openCard(page, card.scanCode);
    await page.getByRole("button", { name: "Vergabe prüfen" }).click();
    await page.getByRole("button", { name: "Ja, vergeben" }).dblclick();
    await expect(booked).toContainText("Neuer Stand: 3 Stempel.");
    await expect(booked).toHaveCount(0, { timeout: 8_000 });
    expect(await balanceOf(url, card.cardToken)).toBe(3);

    // A slow answer that arrives after the cashier already moved on never reopens or closes anything.
    await openCard(page, card.scanCode);
    await page.route("**/api/cashier/award", async route => { await new Promise(resolve => setTimeout(resolve, 1_500)); await route.continue(); });
    await page.getByRole("button", { name: "Vergabe prüfen" }).click();
    await page.getByRole("button", { name: "Ja, vergeben" }).click();
    await page.locator(".card-result-head").getByRole("button", { name: "Andere Karte" }).click();
    await expect(page.getByRole("button", { name: "Kamera öffnen" })).toBeVisible();
    await expect(page.locator(".cashier-status")).toContainText(`für ${card.cardLocator} vergeben`, { timeout: 5_000 });
    await expect(page.locator(".balance-display")).toHaveCount(0);
    await expect(booked).toHaveCount(0);
    await page.unroute("**/api/cashier/award");
    expect(await balanceOf(url, card.cardToken)).toBe(4);

    // A lost answer: the retry keeps its request key and is not booked twice; the offline queue is not offered while
    // the online result is unclear.
    await openCard(page, card.scanCode);
    let dropped = false;
    await page.route("**/api/cashier/award", async route => {
      if (dropped) return route.continue();
      dropped = true;
      await route.fetch(); // the server books it ...
      await route.abort("internetdisconnected"); // ... but the answer never reaches the counter
    });
    await page.getByRole("button", { name: "Vergabe prüfen" }).click();
    await page.getByRole("button", { name: "Ja, vergeben" }).click();
    await expect(page.locator(".cashier-status")).toContainText("Ergebnis unklar");
    await expect(page.locator(".balance-display")).toBeVisible();
    await page.getByRole("button", { name: "Vergabe prüfen" }).click();
    await expect(page.getByRole("button", { name: "Offline-Vergabe vormerken" })).toHaveCount(0);
    await page.getByRole("button", { name: "Ja, vergeben" }).click();
    await expect(booked).toContainText(`Dieser Vorgang für ${card.cardLocator} war bereits gebucht.`);
    await page.unroute("**/api/cashier/award");
    expect(await balanceOf(url, card.cardToken)).toBe(5);

    // The cashier gives up on an unclear booking and moves on; when the card is opened again, the same request is
    // resumed, so confirming it again still books only once.
    await openCard(page, card.scanCode);
    dropped = false;
    await page.route("**/api/cashier/award", async route => {
      if (dropped) return route.continue();
      dropped = true;
      await route.fetch();
      await route.abort("internetdisconnected");
    });
    await page.getByRole("button", { name: "Vergabe prüfen" }).click();
    await page.getByRole("button", { name: "Ja, vergeben" }).click();
    await expect(page.locator(".cashier-status")).toContainText("Ergebnis unklar");
    await page.locator(".card-result-head").getByRole("button", { name: "Andere Karte" }).click();
    await openCard(page, card.scanCode);
    await expect(page.locator(".cashier-status")).toContainText(`Der letzte Vorgang für ${card.cardLocator} hat ein unklares Ergebnis (1 Stempel).`);
    await page.getByRole("button", { name: "Vergabe prüfen" }).click();
    await expect(page.getByRole("button", { name: "Offline-Vergabe vormerken" })).toHaveCount(0);
    await page.getByRole("button", { name: "Ja, vergeben" }).click();
    await expect(booked).toContainText(`Dieser Vorgang für ${card.cardLocator} war bereits gebucht.`);
    await page.unroute("**/api/cashier/award");
    expect(await balanceOf(url, card.cardToken)).toBe(6);

    // A handheld scanner: right after a booking the code field has the focus, so the next guest's code goes straight in.
    const next = await guestCard(url, shop.programSlug);
    await openCard(page, card.scanCode);
    await page.getByRole("button", { name: "Vergabe prüfen" }).click();
    await page.getByRole("button", { name: "Ja, vergeben" }).click();
    await expect(booked).toContainText(`für ${card.cardLocator} vergeben`);
    await expect(page.getByLabel("Kartennummer oder Kartencode")).toBeFocused();
    await page.keyboard.type(next.scanCode);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: next.cardLocator })).toBeVisible();
    await expect(booked).toHaveCount(0);
    await expect(page.locator(".balance-display")).toContainText("0");
    await page.waitForTimeout(4_500);
    await expect(page.getByRole("heading", { name: next.cardLocator })).toBeVisible();
    expect(await balanceOf(url, card.cardToken)).toBe(7);
    expect(await balanceOf(url, next.cardToken)).toBe(0);
  } finally { await counter.close(); await shop.owner.dispose(); }
});

test("the offline fallback appears only with real connection trouble and still queues and syncs", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const shop = await merchant(url, "Synthetic Offline Pizzeria");
  const card = await guestCard(url, shop.programSlug);
  const counter = await browser.newContext({ baseURL: url, storageState: await shop.owner.storageState() });
  try {
    const page = await counter.newPage();
    await page.goto("/cashier");
    await page.getByLabel("Kartennummer oder Kartencode").fill(card.cardLocator);
    await page.getByRole("button", { name: "Prüfen", exact: true }).click();
    const leased = page.waitForResponse(response => response.url().includes("/api/cashier/offline/lease") && response.ok());
    await page.getByRole("button", { name: "Karte öffnen" }).click();
    await leased;
    await expect(page.getByRole("region", { name: "Offline-Vergaben" })).toHaveCount(0);

    await counter.setOffline(true);
    await expect(page.getByRole("region", { name: "Offline-Vergaben" })).toBeVisible();
    await page.getByRole("button", { name: "Vergabe prüfen" }).click();
    await expect(page.getByText("Verbindung zum Server gestört.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Offline-Vergabe vormerken" }).click();
    await expect(page.locator(".cashier-booked")).toContainText(`1 Stempel für ${card.cardLocator} offline vorgemerkt.`);
    await expect(page.getByRole("button", { name: "Vergabe prüfen" })).toHaveCount(0);
    const queue = page.getByRole("region", { name: "Offline-Vergaben" });
    await expect(queue).toContainText("1 ausstehend");
    await expect(queue).toContainText(card.cardLocator);
    expect(await balanceOf(url, card.cardToken)).toBe(0);

    await counter.setOffline(false);
    await page.getByRole("button", { name: "Ausstehende Vergaben synchronisieren" }).click();
    await expect(queue).toContainText("Vom Server angenommen");
    expect(await balanceOf(url, card.cardToken)).toBe(1);
    await page.getByRole("button", { name: "Geprüft, aus Liste entfernen" }).click();
    // With nothing left to review and the connection back, the panel leaves the normal counter again after a successful request.
    await openCard(page, card.scanCode);
    await expect(page.getByRole("region", { name: "Offline-Vergaben" })).toHaveCount(0);
  } finally { await counter.close(); await shop.owner.dispose(); }
});

test("the guest's open card catches up after a booking when they look at it again, without request storms", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const shop = await merchant(url, "Synthetic Aktuell Pizzeria");
  const card = await guestCard(url, shop.programSlug);
  const phone = await browser.newContext({ baseURL: url });
  try {
    const page = await phone.newPage();
    const reads: number[] = [];
    page.on("request", request => { if (request.method() === "GET" && new URL(request.url()).pathname === `/api/card/${card.cardToken}`) reads.push(Date.now()); });
    await page.goto(`/card/${encodeURIComponent(card.cardToken)}`);
    await expect(page.locator(".customer-balance-line strong")).toHaveText("0 Stempel");
    await page.waitForTimeout(500);
    // Development mode runs the initial effect twice (React Strict Mode); count from the settled initial load.
    const initial = reads.length;
    expect(initial).toBeGreaterThanOrEqual(1);

    const returnToPage = () => page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    // Focus right after loading does not re-read.
    await returnToPage();
    await page.waitForTimeout(500);
    expect(reads).toHaveLength(initial);

    const membershipId = await awardViaApi(shop.owner, card.scanCode);
    await page.waitForTimeout(5_200);
    await returnToPage();
    await expect(page.locator(".customer-balance-line strong")).toHaveText("1 Stempel");
    await expect(page.locator(".customer-activity-list")).toContainText("+1 Stempel");
    expect(reads).toHaveLength(initial + 1);

    // Rapid app switching is coalesced.
    for (let index = 0; index < 5; index++) await returnToPage();
    await page.waitForTimeout(800);
    expect(reads).toHaveLength(initial + 1);

    // A link that was reissued elsewhere stops showing the old card and says what to do.
    const reissue = await shop.owner.post(`/api/merchant/customers/${membershipId}/reissue`, { data: { reason: "Neues Handy, Kartennummer genannt", verificationMethod: "other_check", entitlementConfirmed: true, idempotencyKey: randomUUID() } });
    expect(reissue.status()).toBe(200);
    await page.waitForTimeout(5_200);
    await returnToPage();
    await expect(page.getByRole("heading", { name: "Karte nicht erreichbar." })).toBeVisible();
    await expect(page.getByText("Dieser Kartenlink ist nicht mehr gültig.", { exact: false })).toBeVisible();
  } finally { await phone.close(); await shop.owner.dispose(); }
});
