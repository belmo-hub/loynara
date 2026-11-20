import { createHash, randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type APIRequestContext } from "@playwright/test";
import { signUp } from "./support/sign-up";

async function signup(baseURL: string, label: string) {
  const context = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL).origin } });
  const email = `${label}-${randomUUID()}@example.test`;
  expect((await signUp(context, { data: { name: `Synthetic ${label}`, email, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  return { context, email };
}

async function onboard(context: APIRequestContext, name: string) {
  const response = await context.post("/api/merchant/onboard", { data: {
    businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
    programName: `${name} card`, programType: "stamp", rulesText: "One synthetic stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5,
  } });
  expect(response.status()).toBe(201);
  return await response.json() as { locationId: string; programSlug: string };
}

async function card(baseURL: string, slug: string) {
  const guest = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL).origin } });
  try {
    const joined = await guest.post("/api/enroll", { data: { slug, acceptedTerms: true, marketingOptIn: false } });
    expect(joined.status()).toBe(201);
    const { cardToken } = await joined.json() as { cardToken: string };
    const response = await guest.get(`/api/card/${encodeURIComponent(cardToken)}`);
    expect(response.status()).toBe(200);
    const { scanCode, balance } = await response.json() as { scanCode: string; balance: number };
    return { cardToken, scanCode, balance };
  } finally { await guest.dispose(); }
}

async function withForgedSelection(baseURL: string, source: APIRequestContext, locationId: string) {
  const current = await source.get("/api/me");
  expect(current.status()).toBe(200);
  const { userId } = await current.json() as { userId: string };
  const cookieName = `looplocal_location_${createHash("sha256").update(userId).digest("hex").slice(0, 20)}`;
  const state = await source.storageState();
  const baseCookie = state.cookies[0];
  if (!baseCookie) throw new Error("Authenticated cookie state missing");
  state.cookies = [...state.cookies.filter(cookie => cookie.name !== cookieName), { ...baseCookie, name: cookieName, value: locationId }];
  return apiRequest.newContext({ baseURL, storageState: state, extraHTTPHeaders: { Origin: new URL(baseURL).origin } });
}

test("a new points location takes optional extra rules, a stamp location still needs its rule (ENG-099 3c)", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const owner = await signup(url, "rules-owner");
  try {
    await onboard(owner.context, "Synthetic Rules A");
    const context = await browser.newContext({ baseURL: url, storageState: await owner.context.storageState() });
    try {
      const page = await context.newPage();
      const posts: string[] = [];
      page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/merchant/locations") posts.push(request.postData() ?? ""); });
      await page.goto("/merchant/locations/new");
      await page.getByLabel("Standortname").fill("Synthetic Rules Counter");
      await page.getByLabel("Stadt").fill("Bonn");
      await page.getByLabel("Programmname").fill("Synthetic rules card");
      await page.getByLabel("Erste Prämie").fill("Kaffee");
      const create = page.getByRole("button", { name: "Standort und Programm anlegen" });
      await page.getByLabel("Regel auf der Karte").fill("Zu kurz.");
      await create.click();
      expect(await page.getByLabel("Regel auf der Karte").evaluate(field => (field as HTMLTextAreaElement).validity.tooShort)).toBe(true);
      expect(posts).toHaveLength(0);
      // Points earn by the purchase amount here: the card states that rule, so the field is for optional extra rules.
      await page.getByLabel("Programmtyp").selectOption("points");
      const extras = page.getByLabel("Weitere Regeln (optional)", { exact: true });
      await expect(extras).toHaveValue("");
      await expect(extras).toHaveAttribute("placeholder", "z. B. Karte vor dem Bezahlen zeigen. Nachträglich gibt es keine Punkte.");
      await create.click();
      await expect(page.getByRole("status").filter({ hasText: "Standort mit eigenem Programm" })).toBeVisible();
      expect(posts.map(body => JSON.parse(body))).toMatchObject([{ programType: "points", earningMode: "purchase", rulesText: "" }]);
    } finally { await context.close(); }
  } finally { await owner.context.dispose(); }
});

test("owner creates and selects a second location without crossing card or staff boundaries", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const ownerA = await signup(url, "multi-owner-a");
  const ownerB = await signup(url, "multi-owner-b");
  const cashier = await signup(url, "multi-cashier");
  let ownerSelected: APIRequestContext | null = null;
  try {
    const original = await onboard(ownerA.context, "Synthetic Multi A");
    const foreign = await onboard(ownerB.context, "Synthetic Multi B");
    const oldCard = await card(url, original.programSlug);
    const oldLookup = await ownerA.context.get(`/api/cashier/lookup?code=${encodeURIComponent(oldCard.scanCode)}`);
    expect(oldLookup.status()).toBe(200);
    const { membershipId: oldMembershipId } = await oldLookup.json() as { membershipId: string };
    const oldAward = await ownerA.context.post("/api/cashier/award", { data: { membershipId: oldMembershipId, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() } });
    expect(oldAward.status()).toBe(200);
    const { entryId: oldEntryId } = await oldAward.json() as { entryId: string };

    const ownerBrowser = await browser.newContext({ baseURL: url, storageState: await ownerA.context.storageState() });
    try {
      const page = await ownerBrowser.newPage();
      await page.goto("/merchant/locations");
      await expect(page.getByRole("heading", { name: "Standorte", exact: true })).toBeVisible();
      await expect(page.locator("main").getByText("Synthetic Multi A", { exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Standort hinzufügen" }).click();
      await page.getByLabel("Standortname").fill("Synthetic Berlin Counter");
      await page.getByLabel("Stadt").fill("Berlin");
      await page.getByLabel("Programmname").fill("Synthetic Berlin card");
      await page.getByLabel("Regel auf der Karte").fill("Ein Stempel pro bestätigtem synthetischem Kassenvorgang.");
      await page.getByLabel("Erste Prämie").fill("Berlin coffee");
      await page.getByRole("button", { name: "Standort und Programm anlegen" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Standort mit eigenem Programm" })).toBeVisible();
      await expect(page.locator("main").getByText("Synthetic Berlin Counter", { exact: true })).toBeVisible();
      await expect(page.locator("main").getByText("Aktiver Standort", { exact: true })).toBeVisible();
      ownerSelected = await apiRequest.newContext({ baseURL: url, storageState: await ownerBrowser.storageState(), extraHTTPHeaders: { Origin: new URL(url).origin } });
    } finally { await ownerBrowser.close(); }

    if (!ownerSelected) throw new Error("Selected owner session missing");
    const selection = await ownerSelected.get("/api/me");
    expect(selection.status()).toBe(200);
    const selected = await selection.json() as { locationId: string; programSlug: string; locationName: string };
    expect(selected.locationName).toBe("Synthetic Berlin Counter");
    const newCard = await card(url, selected.programSlug);
    const newLookup = await ownerSelected.get(`/api/cashier/lookup?code=${encodeURIComponent(newCard.scanCode)}`);
    expect(newLookup.status()).toBe(200);
    expect((await ownerSelected.get(`/api/cashier/lookup?code=${encodeURIComponent(oldCard.scanCode)}`)).status()).toBe(404);
    expect((await ownerSelected.post("/api/cashier/award", { data: { membershipId: oldMembershipId, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() } })).status()).toBe(404);
    expect((await ownerSelected.post("/api/transactions/reverse", { data: { locationId: original.locationId, entryId: oldEntryId, reason: "Synthetic cross-location correction", idempotencyKey: randomUUID() } })).status()).toBe(404);
    expect((await ownerSelected.post("/api/staff/invite", { data: { locationId: original.locationId, email: cashier.email, role: "cashier" } })).status()).toBe(404);
    const locations = await ownerSelected.get("/api/merchant/locations");
    expect(locations.status()).toBe(200);
    expect(await locations.json()).toMatchObject({ scope: "all_merchant_locations", totals: { locations: 2, cards: 2, awards: 1 } });
    const oldBalance = await apiRequest.newContext({ baseURL: url });
    try { expect((await oldBalance.get(`/api/card/${encodeURIComponent(oldCard.cardToken)}`).then(response => response.json()) as { balance: number }).balance).toBe(2); }
    finally { await oldBalance.dispose(); }

    const invite = await ownerSelected.post("/api/staff/invite", { data: { locationId: selected.locationId, email: cashier.email, role: "cashier" } });
    expect(invite.status()).toBe(201);
    const { token } = await invite.json() as { token: string };
    expect((await cashier.context.post("/api/staff/accept", { data: { token } })).status()).toBe(200);
    expect((await cashier.context.get("/api/merchant/locations")).status()).toBe(403);
    expect((await cashier.context.post("/api/merchant/locations/select", { data: { locationId: original.locationId } })).status()).toBe(403);
    const cashierForged = await withForgedSelection(url, cashier.context, original.locationId);
    try {
      const cashierMe = await cashierForged.get("/api/me");
      expect((await cashierMe.json() as { locationId: string }).locationId).toBe(selected.locationId);
      expect((await cashierForged.get(`/api/cashier/lookup?code=${encodeURIComponent(oldCard.scanCode)}`)).status()).toBe(404);
      expect((await cashierForged.get(`/api/cashier/lookup?code=${encodeURIComponent(newCard.scanCode)}`)).status()).toBe(200);
    } finally { await cashierForged.dispose(); }

    const ownerForeign = await withForgedSelection(url, ownerSelected, foreign.locationId);
    try {
      expect((await ownerForeign.get("/api/me")).status()).toBe(404);
      expect((await ownerForeign.get(`/api/cashier/lookup?code=${encodeURIComponent(oldCard.scanCode)}`)).status()).toBe(404);
    } finally { await ownerForeign.dispose(); }

    const ownerBState = await ownerB.context.storageState();
    const oldOwnerSelection = (await ownerSelected.storageState()).cookies.find(cookie => cookie.name.startsWith("looplocal_location_"));
    if (!oldOwnerSelection) throw new Error("Owner selection cookie missing");
    ownerBState.cookies.push(oldOwnerSelection);
    const switchedAccount = await apiRequest.newContext({ baseURL: url, storageState: ownerBState });
    try { expect((await switchedAccount.get("/api/me").then(response => response.json()) as { locationId: string }).locationId).toBe(foreign.locationId); }
    finally { await switchedAccount.dispose(); }

    expect((await ownerSelected.post("/api/merchant/locations/select", { data: { locationId: original.locationId } })).status()).toBe(200);
    expect((await ownerSelected.get(`/api/cashier/lookup?code=${encodeURIComponent(oldCard.scanCode)}`)).status()).toBe(200);
    expect((await ownerSelected.get(`/api/cashier/lookup?code=${encodeURIComponent(newCard.scanCode)}`)).status()).toBe(404);
  } finally { await Promise.all([ownerA.context.dispose(), ownerB.context.dispose(), cashier.context.dispose(), ownerSelected?.dispose()]); }
});
