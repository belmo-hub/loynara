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

  await signInWithPassword();
  await page.goto("/merchant/more");
  await page.getByRole("button", { name: /Passkey hinzufügen/ }).click();
  await expect(page.getByText("Passkey gespeichert. Du kannst dich jetzt damit anmelden.")).toBeAttached();
  await expect(page.getByRole("button", { name: "Entfernen", exact: true })).toHaveCount(1);

  // Signed out, the sign-in page offers the passkey in the address field's autofill; the virtual authenticator accepts it.
  await page.context().clearCookies();
  await page.goto("/login");
  await expect(page).toHaveURL(/\/merchant/, { timeout: 20_000 });

  // The password keeps working with a passkey saved (the authenticator is gone, so autofill offers nothing).
  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  await page.context().clearCookies();
  await signInWithPassword();
});
