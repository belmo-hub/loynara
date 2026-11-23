import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";
import { signUp } from "./support/sign-up";

// Web audit finding 10: passkeys are optional next to the password. Chrome's virtual authenticator stands in for the
// phone's Face ID or fingerprint, so this runs on the synthetic local app only.
test("an owner adds a passkey under Mehr, signs in with it from the address field, and the password still works", async ({ page, baseURL }) => {
  const url = new URL(baseURL ?? "http://localhost:3000");
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Passkey tests require the synthetic local app");
  const api = await apiRequest.newContext({ baseURL: url.origin, extraHTTPHeaders: { Origin: url.origin } });
  const email = `passkey-${randomUUID()}@example.test`, password = `Local!${randomUUID()}Aa`;
  expect((await signUp(api, { data: { name: "Synthetic passkey owner", email, password } })).status()).toBe(200);
  expect((await api.post("/api/merchant/onboard", { data: { businessName: "Synthetic Passkey Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Passkey card", programType: "stamp", rulesText: "Synthetic local test only.", rewardTitle: "Kaffee", rewardCost: 5 } })).status()).toBe(201);
  await api.dispose();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  const signInWithPassword = async () => {
    await page.goto("/login");
    await page.getByLabel("E-Mail-Adresse", { exact: true }).fill(email);
    await page.getByLabel("Passwort", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
    await expect(page).toHaveURL(/\/merchant/);
  };

  const uv = { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } as const;
  const rows = () => page.getByRole("button", { name: / entfernen$/ }); // each row's button is named „<Name> entfernen“

  await signInWithPassword();
  await page.goto("/merchant/more");
  await page.getByRole("button", { name: /Passkey hinzufügen/ }).click();
  // The outcome is a visible line under the panel; the row is named by its device (desktop Chrome: „Mac“ or „Windows-PC“).
  await expect(page.locator(".ow-prog-outcome")).toHaveText("Passkey hinzugefügt. Du kannst dich jetzt damit anmelden.");
  await expect(rows()).toHaveCount(1);
  await expect(page.locator(".ow-prog-row strong", { hasText: /^(Mac|Windows-PC|Passkey)$/ })).toHaveCount(1);

  // Signed out, the sign-in page offers the passkey in the address field's autofill; the virtual authenticator accepts it.
  await page.context().clearCookies();
  await page.goto("/login");
  await expect(page).toHaveURL(/\/merchant/, { timeout: 20_000 });

  // A second passkey (another authenticator: one cannot register twice) is its own row, one <li> each.
  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  const second = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: uv });
  await page.goto("/merchant/more");
  await page.getByRole("button", { name: /Passkey hinzufügen/ }).click();
  await expect(rows()).toHaveCount(2);
  expect(await page.locator("li:has(#passkey-add)").count()).toBe(1);
  expect(await page.locator("li:has(button:text-is('Entfernen'))").count()).toBe(2);
  // Removing asks first, names the passkey, and hands the focus to the next row's „Entfernen“.
  // The removed row only ever goes open → closing → gone after the tap, and never comes back while the list reloads.
  const removedId = await rows().first().getAttribute("id");
  await rows().first().click();
  await expect(page.getByRole("heading", { name: "Passkey entfernen?" })).toBeVisible();
  await expect(page.getByText("Du meldest dich dann wieder mit deinem Passwort an. Lösche ihn auch in den Einstellungen deines Geräts.")).toBeVisible();
  const states = page.evaluate(id => new Promise<string>(resolve => {
    const seen: string[] = [], start = performance.now();
    const tick = () => {
      if (document.querySelector(".ow-prog-outcome")) {
        const row = document.getElementById(id ?? "")?.closest(".ow-rowfold");
        const state = !row ? "gone" : row.hasAttribute("data-closing") ? "closing" : "open";
        if (seen.at(-1) !== state) seen.push(state);
      }
      if (performance.now() - start < 800) requestAnimationFrame(tick); else resolve(seen.join(" "));
    };
    requestAnimationFrame(tick);
  }), removedId);
  await page.getByRole("button", { name: "Entfernen", exact: true }).click();
  await expect(page.locator(".ow-prog-outcome")).toHaveText("Passkey entfernt.");
  expect(await states).toMatch(/^(open )?(closing )?gone$/);
  await expect(rows()).toHaveCount(1);
  await expect(rows()).toBeFocused();

  // The password keeps working with a passkey saved (no authenticator, so autofill offers nothing).
  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: second.authenticatorId });
  await page.context().clearCookies();
  await signInWithPassword();
});

// Design, #349 round 2: a session older than 10 minutes gets a neutral step with „Neu anmelden“, not a dead end.
test("adding a passkey with an older sign-in offers to sign in again and comes back to Konto", async ({ page, baseURL }) => {
  const url = new URL(baseURL ?? "http://localhost:3000");
  const api = await apiRequest.newContext({ baseURL: url.origin, extraHTTPHeaders: { Origin: url.origin } });
  const email = `passkey-${randomUUID()}@example.test`, password = `Local!${randomUUID()}Aa`;
  expect((await signUp(api, { data: { name: "Synthetic passkey owner", email, password } })).status()).toBe(200);
  expect((await api.post("/api/merchant/onboard", { data: { businessName: "Synthetic Passkey Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Passkey card", programType: "stamp", rulesText: "Synthetic local test only.", rewardTitle: "Kaffee", rewardCost: 5 } })).status()).toBe(201);
  await page.context().addCookies((await api.storageState()).cookies);
  await api.dispose();
  // The plugin answers an old session with 403 SESSION_NOT_FRESH; stand in for the 10 minutes having passed.
  await page.route("**/api/auth/passkey/generate-register-options*", route => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "SESSION_NOT_FRESH", message: "Session is not fresh" }) }));
  await page.goto("/merchant/more");
  await page.getByRole("button", { name: /Passkey hinzufügen/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Zum Hinzufügen meldest du dich einmal mit deinem Passwort neu an." })).toBeInViewport();
  await expect(page.locator(".ow-prog-note.ow-error")).toHaveCount(0);
  await page.getByRole("button", { name: "Neu anmelden", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fmerchant%2Fmore$/);
  await expect(page.getByText("Danach kannst du deinen Passkey hinzufügen.")).toBeVisible();
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.getByLabel("E-Mail-Adresse", { exact: true }).fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL(/\/merchant\/more$/);
});

// Design, #349 round 2: a passkey the server no longer knows (removed elsewhere, deleted by a password reset) says so in
// the form, and the page stays on /login instead of navigating without a session.
test("a passkey that no longer works says so on the sign-in page and stays there", async ({ page, baseURL }) => {
  const url = new URL(baseURL ?? "http://localhost:3000");
  const api = await apiRequest.newContext({ baseURL: url.origin, extraHTTPHeaders: { Origin: url.origin } });
  const email = `passkey-${randomUUID()}@example.test`, password = `Local!${randomUUID()}Aa`;
  expect((await signUp(api, { data: { name: "Synthetic passkey owner", email, password } })).status()).toBe(200);
  expect((await api.post("/api/merchant/onboard", { data: { businessName: "Synthetic Passkey Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Passkey card", programType: "stamp", rulesText: "Synthetic local test only.", rewardTitle: "Kaffee", rewardCost: 5 } })).status()).toBe(201);
  await page.context().addCookies((await api.storageState()).cookies);
  await api.dispose();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.goto("/merchant/more");
  await page.getByRole("button", { name: /Passkey hinzufügen/ }).click();
  await expect(page.getByRole("button", { name: / entfernen$/ })).toHaveCount(1);
  await page.context().clearCookies();
  await page.route("**/api/auth/passkey/verify-authentication", route => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "PASSKEY_NOT_FOUND", message: "Passkey not found" }) }));
  await page.goto("/login");
  await expect(page.getByText("Mit diesem Passkey ging es nicht. Melde dich mit deinem Passwort an.")).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(/\/login$/);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

// Design, #349 round 2: a failed options request on page load is not the person's passkey failing: no alert.
test("a failed passkey options request on the sign-in page stays quiet", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  let calls = 0;
  await page.route("**/api/auth/passkey/generate-authenticate-options*", route => { calls += 1; return route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ message: "Too many requests" }) }); });
  await page.goto("/login");
  await expect.poll(() => calls).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0); // the route announcer is an empty alert
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

// Design, #349 round 2: a passkey the server accepted without leaving a session gets the form's existing line.
test("a passkey sign-in that leaves no session says so", async ({ page, baseURL }) => {
  const url = new URL(baseURL ?? "http://localhost:3000");
  const api = await apiRequest.newContext({ baseURL: url.origin, extraHTTPHeaders: { Origin: url.origin } });
  const email = `passkey-${randomUUID()}@example.test`, password = `Local!${randomUUID()}Aa`;
  expect((await signUp(api, { data: { name: "Synthetic passkey owner", email, password } })).status()).toBe(200);
  expect((await api.post("/api/merchant/onboard", { data: { businessName: "Synthetic Passkey Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Passkey card", programType: "stamp", rulesText: "Synthetic local test only.", rewardTitle: "Kaffee", rewardCost: 5 } })).status()).toBe(201);
  await page.context().addCookies((await api.storageState()).cookies);
  await api.dispose();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.goto("/merchant/more");
  await page.getByRole("button", { name: /Passkey hinzufügen/ }).click();
  await expect(page.getByRole("button", { name: / entfernen$/ })).toHaveCount(1);
  await page.context().clearCookies();
  // The server says yes but sets no cookie: the page must not lead on without a session.
  await page.route("**/api/auth/passkey/verify-authentication", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session: { id: "none" } }) }));
  await page.goto("/login");
  await expect(page.getByText("Die Anmeldung konnte nicht bestätigt werden. Prüfe deine Verbindung und versuche es erneut.")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

// A browser that rejects an empty conditional request at once reads as a cancel: the sign-in page must not ask again
// until the person comes back to the address field.
test("a passkey prompt that closes at once is not asked for again in a loop", async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  let calls = 0;
  page.on("request", request => { if (request.url().includes("/passkey/generate-authenticate-options")) calls += 1; });
  await page.goto("/login");
  await page.waitForTimeout(2000);
  expect(calls).toBeLessThanOrEqual(2); // one per effect run (development runs effects twice)
});
