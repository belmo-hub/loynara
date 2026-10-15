import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, request as apiRequest, test, type Page } from "@playwright/test";

// Open registration and the invitation each keep their own form: uncontrolled fields, a hydration gate, mapped errors.
// The page's scripts are held behind a barrier until every field is filled, so the fields are certainly filled before
// React hydrates (what a password manager does on a slow phone), then released.

const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string; ownerPassword: string };
const inviteServer = process.env.E2E_INVITE_SIGNUP === "true";

async function holdScripts(page: Page) {
  let release!: () => void;
  const barrier = new Promise<void>(open => { release = open; });
  await page.route("**/_next/static/**/*.js", async route => { await barrier; await route.continue(); });
  return release;
}

/** Answers sign-up with a refusal and records what the form sent. */
async function refuseSignUp(page: Page) {
  const sent: { body: Record<string, unknown> | null; invite: string | null } = { body: null, invite: null };
  await page.route("**/api/auth/sign-up/email", async route => {
    sent.body = route.request().postDataJSON(); sent.invite = route.request().headers()["x-loynara-invite"] ?? null;
    await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "FORBIDDEN", message: "Registration is not enabled" }) });
  });
  return sent;
}

test("registration: early input reaches the request, and a refusal is explained in German", async ({ page }) => {
  test.skip(inviteServer, "Public registration is off on the invite-only server");
  const release = await holdScripts(page);
  const sent = await refuseSignUp(page);
  await page.goto("/register", { waitUntil: "commit" });
  const submit = page.getByRole("button", { name: "Konto erstellen", exact: true });
  await expect(submit).toBeDisabled();
  await page.getByLabel("Dein Name", { exact: true }).fill("Früh Ausgefüllt");
  await page.getByLabel("E-Mail-Adresse", { exact: true }).fill("frueh@example.test");
  await page.getByLabel("Passwort", { exact: true }).fill("Langes-Passwort-123");
  await page.getByLabel("Passwort wiederholen", { exact: true }).fill("Langes-Passwort-123");
  await expect(submit).toBeDisabled();
  release();
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await submit.click();
  await expect.poll(() => sent.body).toMatchObject({ name: "Früh Ausgefüllt", email: "frueh@example.test", password: "Langes-Passwort-123" });
  const alert = page.locator(".auth-form").getByRole("alert");
  await expect(alert).toContainText("Registrierung ist noch nicht freigeschaltet");
  await expect(alert).not.toContainText("Registration");
  await expect(page.getByLabel("E-Mail-Adresse", { exact: true })).toHaveValue("frueh@example.test");
});

test("invitation: early input reaches the request, and a stale invitation asks for a new one", async ({ page, baseURL }) => {
  test.skip(!inviteServer, "Requires the invite-only server (public registration off, invite sign-up on)");
  const url = baseURL ?? "http://localhost:3000";
  const api = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  let token = "", email = "";
  try {
    expect((await api.post("/api/auth/sign-in/email", { data: { email: demo.ownerEmail, password: demo.ownerPassword } })).status()).toBe(200);
    const owner = await (await api.get("/api/me")).json() as { locationId: string };
    email = `invite-hydration-${randomUUID()}@example.test`;
    const invited = await api.post("/api/staff/invite", { data: { email, locationId: owner.locationId, role: "cashier" } });
    expect(invited.status()).toBe(201);
    token = (await invited.json() as { token: string }).token;
  } finally { await api.dispose(); }

  const release = await holdScripts(page);
  const sent = await refuseSignUp(page);
  await page.goto(`/invite/${token}`, { waitUntil: "commit" });
  const submit = page.getByRole("button", { name: "Zugang einrichten", exact: true });
  await expect(submit).toBeDisabled();
  await page.getByLabel("Dein Name", { exact: true }).fill("Früh Eingeladen");
  await page.getByLabel("Passwort", { exact: true }).fill("Langes-Passwort-123");
  await page.getByLabel("Passwort wiederholen", { exact: true }).fill("Langes-Passwort-123");
  release();
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await submit.click();
  await expect.poll(() => sent.body).toMatchObject({ name: "Früh Eingeladen", email, password: "Langes-Passwort-123" });
  expect(sent.invite).toBe(token);
  const alert = page.locator(".auth-form").getByRole("alert");
  await expect(alert).toContainText("neue Einladung");
  await expect(alert).not.toContainText("Registration");
});
