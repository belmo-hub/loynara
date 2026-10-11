import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import jsQR from "jsqr";
import { pool } from "../src/db";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== "55433" || database.pathname !== "/looplocal_browser_qr_089") throw new Error("Dedicated synthetic QR database required");
const origin = "http://localhost:3000";
test.afterAll(async () => { await pool.end(); });
for (const [type, width] of [["stamp", 375], ["points", 1280]] as const) test(`downloaded ${type} sign decodes to its own customer destination (${width}px)`, async ({ browser, baseURL }) => {
  expect(baseURL).toBe(origin);
  const owner = await browser.newContext({ baseURL }), customer = await browser.newContext({ baseURL, viewport: { width, height: 812 } });
  try {
    const id = randomUUID(), name = `Synthetic ${type} & Co ${id}`, location = `Synthetic ${type} location`;
    const signup = await owner.request.post("/api/auth/sign-up/email", { headers: { Origin: origin }, data: { name: "Synthetic QR owner", email: `${id}@example.test`, password: "Synthetic-QR-089-Only!" } }); expect(signup.ok()).toBe(true);
    const setup = await owner.request.post("/api/merchant/onboard", { headers: { Origin: origin }, data: { businessName: name, locationName: location, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic QR card", programType: type, rulesText: "Synthetic confirmed purchase", rewardTitle: "Coffee", rewardCost: type === "stamp" ? 5 : 100 } }); expect(setup.status()).toBe(201); const merchant = await setup.json();
    const page = await owner.newPage(); await page.goto("/merchant/settings");
    const joinUrl = `${origin}/join/${merchant.programSlug}`; await expect(page.getByLabel("Anmeldelink", { exact: true })).toHaveValue(joinUrl);
    const downloadEvent = page.waitForEvent("download"); await page.getByRole("button", { name: "Tresenschild laden", exact: true }).click(); const download = await downloadEvent; expect(download.suggestedFilename()).toBe("anmeldeschild.html"); const path = await download.path(); expect(path).not.toBeNull(); const html = await readFile(path!, "utf8");
    // Render the actual downloaded artifact, rather than rebuilding it from the source helper.
    const artifact = await customer.newPage(); await artifact.setContent(html); await expect(artifact.locator("h1")).toHaveText(name); await expect(artifact.locator(".location")).toHaveText(location); await expect(artifact.locator(".join-url")).toHaveText(joinUrl); await expect(artifact.locator(".reward")).toContainText("Coffee");
    const pixels = await sharp(await artifact.locator(".qr").screenshot()).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); const decoded = jsQR(new Uint8ClampedArray(pixels.data), pixels.info.width, pixels.info.height); expect(decoded?.data).toBe(joinUrl);
    const decodedUrl = new URL(decoded!.data); expect(decodedUrl.search).toBe(""); expect(decodedUrl.hash).toBe("");
    const destination = await customer.newPage(); await destination.goto(decoded!.data); await expect(destination.getByRole("button", { name: "Meine Karte erstellen", exact: true })).toBeVisible(); await expect(destination.locator("body")).toContainText(name);
    expect((await pool.query("SELECT count(*)::int AS n FROM memberships WHERE tenant_id=$1", [merchant.tenantId])).rows[0].n).toBe(0);
    const response = destination.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/enroll"); await destination.getByRole("checkbox").check(); await destination.getByRole("button", { name: "Meine Karte erstellen", exact: true }).click(); expect((await response).status()).toBe(201); await expect(destination).toHaveURL(/\/card\/card_[A-Za-z0-9_-]+$/); const cardUrl = destination.url();
    await destination.goto(joinUrl); await expect(destination.getByRole("heading", { name: "Willkommen zurück.", exact: true })).toBeVisible(); await destination.getByRole("link", { name: "Meine Karte öffnen", exact: true }).click(); await expect(destination).toHaveURL(cardUrl);
    const members = (await pool.query("SELECT balance,program_id FROM memberships WHERE tenant_id=$1", [merchant.tenantId])).rows; expect(members).toHaveLength(1); expect(members[0].balance).toBe(0); expect(members[0].program_id).toBe((await pool.query("SELECT id FROM programs WHERE tenant_id=$1 AND slug=$2", [merchant.tenantId, merchant.programSlug])).rows[0].id);
    for (const table of ["ledger_entries", "outbox_jobs"]) expect((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id=$1`, [merchant.tenantId])).rows[0].n).toBe(0);
    expect((await customer.request.get("/api/me")).status()).toBe(401);
  } finally { await owner.close(); await customer.close(); }
});
