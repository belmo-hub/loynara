import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";
import { pool } from "../src/db";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== "55433" || database.pathname !== "/looplocal_browser_branding_088") throw new Error("Dedicated synthetic branding database required");
const origin = "http://localhost:3000";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
// The error variant injects a delayed read error after a real native read; it is not a natural disk-I/O failure.
// Distinct accepted PNG byte streams, with harmless trailing fixture labels; actual browser FileReader reads them.
const bytes = (label: string) => Buffer.concat([png, Buffer.from(label)]);
const data = (label: string) => `data:image/png;base64,${bytes(label).toString("base64")}`;
let owner: { slug: string; tenant: string; name: string; location: string; storage: Awaited<ReturnType<BrowserContext["storageState"]>> };
let foreign: { tenant: string; initial: unknown };
async function persisted(tenant: string) { return (await pool.query("SELECT id,tenant_id,name,brand_color,logo_data FROM locations WHERE tenant_id=$1 ORDER BY id", [tenant])).rows; }
test.beforeAll(async ({ browser, baseURL }) => {
  if (baseURL !== origin) throw new Error("Loopback required");
  for (const own of [true, false]) {
    const context = await browser.newContext({ baseURL });
    try {
      const id = randomUUID(), name = `Synthetic branding ${id}`, location = "Synthetic Mitte";
      const signup = await context.request.post("/api/auth/sign-up/email", { headers: { Origin: origin }, data: { name: "Synthetic brand owner", email: `${id}@example.test`, password: "Synthetic-Brand-088-Only!" } }); expect(signup.ok()).toBe(true);
      const setup = await context.request.post("/api/merchant/onboard", { headers: { Origin: origin }, data: { businessName: name, locationName: location, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic brand card", programType: "stamp", rulesText: "One synthetic visit", rewardTitle: "Coffee", rewardCost: 5, logoData: data("initial") } }); expect(setup.status()).toBe(201); const merchant = await setup.json();
      if (own) owner = { slug: merchant.programSlug, tenant: merchant.tenantId, name, location, storage: await context.storageState() }; else foreign = { tenant: merchant.tenantId, initial: await persisted(merchant.tenantId) };
    } finally { await context.close(); }
  }
});
test.afterAll(async () => { await pool.end(); });
for (const [action, width] of [["newer", 375], ["remove", 1280], ["discard", 375], ["error", 1280]] as const) test(`older native logo read cannot undo ${action} choice (${width}px)`, async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, storageState: owner.storage, viewport: { width, height: 812 } });
  try {
    const reset = await context.request.post("/api/merchant/program/brand", { headers: { Origin: origin }, data: { programSlug: owner.slug, businessName: owner.name, locationName: owner.location, brandColor: "#214739", logoData: data("initial") } }); expect(reset.status()).toBe(200);
    await context.addInitScript(() => {
      const w = window as typeof window & { __heldLogoRead?: () => void };
      const nativeRead = FileReader.prototype.readAsDataURL;
      FileReader.prototype.readAsDataURL = function (blob) {
        if (blob instanceof File && ["older.png", "older-error.png"].includes(blob.name)) {
          const handler = blob.name === "older-error.png" ? this.onerror : this.onload;
          this.onload = event => { w.__heldLogoRead = () => handler?.call(this, event); };
        }
        return nativeRead.call(this, blob);
      };
    });
    const page = await context.newPage(); await page.goto("/merchant/program/card"); const image = page.getByAltText("Ausgewähltes Logo", { exact: true }); await expect(image).toHaveAttribute("src", data("initial")); const input = page.locator("#cs-logo");
    let writes = 0; page.on("request", r => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/merchant/program/brand") writes++; });
    await input.setInputFiles({ name: action === "error" ? "older-error.png" : "older.png", mimeType: "image/png", buffer: bytes("older") }); await page.waitForFunction(() => typeof (window as typeof window & { __heldLogoRead?: () => void }).__heldLogoRead === "function"); expect(writes).toBe(0); expect((await persisted(owner.tenant))[0].logo_data).toBe(data("initial"));
    if (action === "newer") { await input.setInputFiles({ name: "newer.png", mimeType: "image/png", buffer: bytes("newer") }); await expect(image).toHaveAttribute("src", data("newer")); }
    else if (action === "remove") { await page.getByRole("button", { name: "Logo entfernen", exact: true }).click(); await expect(image).toHaveCount(0); }
    else if (action === "error") { await input.setInputFiles({ name: "rejected.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") }); await expect(page.locator(".ow-error[role=alert]")).toHaveText("Bitte ein PNG-, JPG- oder WebP-Bild wählen."); }
    else { await page.getByLabel("Geschäftsname", { exact: true }).fill("Unsaved synthetic draft"); await page.getByRole("button", { name: "Verwerfen", exact: true }).click(); await expect(page.getByLabel("Geschäftsname", { exact: true })).toHaveValue(owner.name); }
    await page.evaluate(() => (window as typeof window & { __heldLogoRead?: () => void }).__heldLogoRead?.());
    if (action === "error") await expect(page.locator(".ow-error[role=alert]")).toHaveText("Bitte ein PNG-, JPG- oder WebP-Bild wählen.");
    const expected = action === "newer" ? data("newer") : action === "remove" ? null : data("initial");
    if (expected) await expect.soft(image).toHaveAttribute("src", expected); else await expect.soft(image).toHaveCount(0);
    if (action === "discard" || action === "error") {
      await expect.soft(page.locator(".ow-savestate")).toContainText("Keine Änderungen");
      await expect.soft(page.getByRole("button", { name: "Kundenkarte speichern", exact: true })).toBeDisabled();
    } else {
      const saved = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/merchant/program/brand"); await page.getByRole("button", { name: "Kundenkarte speichern", exact: true }).click(); expect((await saved).status()).toBe(200); expect(writes).toBe(1);
    }
    expect.soft((await persisted(owner.tenant))[0].logo_data).toBe(expected); expect(await persisted(foreign.tenant)).toEqual(foreign.initial);
    await page.reload(); if (expected) await expect(image).toHaveAttribute("src", expected); else await expect(image).toHaveCount(0); await expect(page.locator(".ow-savestate")).toContainText("Keine Änderungen");
    expect((await pool.query("SELECT count(*)::int AS n FROM memberships")).rows[0].n).toBe(0); expect((await pool.query("SELECT count(*)::int AS n FROM outbox_jobs")).rows[0].n).toBe(0); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  } finally { await context.close(); }
});
