import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { pool } from "../src/db";
const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== "55433" || database.pathname !== "/looplocal_browser_qr_092") throw new Error("Dedicated synthetic QR-failure database required");
const origin = "http://localhost:3000";
test.afterAll(async () => { await pool.end(); });
for (const [failure, width] of [["http", 375], ["incomplete", 1280], ["reset", 375]] as const) test(`${failure} QR fetch creates no misleading artifact; explicit retry recovers (${width}px)`, async ({ browser, baseURL }) => {
  expect(baseURL).toBe(origin); const context = await browser.newContext({ baseURL, viewport: { width, height: 812 } });
  try {
    const id = randomUUID(), name = `Synthetic QR failure ${id}`;
    const signup = await context.request.post("/api/auth/sign-up/email", { headers: { Origin: origin }, data: { name: "Synthetic QR owner", email: `${id}@example.test`, password: "Synthetic-QR-092-Only!" } }); expect(signup.ok()).toBe(true);
    const setup = await context.request.post("/api/merchant/onboard", { headers: { Origin: origin }, data: { businessName: name, locationName: "Synthetic QR counter", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic card", programType: "stamp", rulesText: "One confirmed purchase", rewardTitle: "Coffee", rewardCost: 5 } }); expect(setup.status()).toBe(201); const merchant = await setup.json();
    const page = await context.newPage(); await page.goto("/merchant/settings"); let requests = 0, downloads = 0;
    page.on("download", () => { downloads++; });
    await page.route("**/api/qr?*", async route => {
      requests++; if (requests > 1) { await route.continue(); return; }
      if (failure === "http") await route.fulfill({ status: 503, contentType: "text/plain", body: "Synthetic private diagnostic must not be downloaded" });
      else if (failure === "reset") await route.abort("connectionreset");
      else { const real = await route.fetch(); expect(real.status()).toBe(200); const svg = await real.text(); await route.fulfill({ response: real, body: svg.slice(0, Math.floor(svg.length / 2)) }); }
    });
    await page.getByRole("button", { name: "Tresenschild laden", exact: true }).click(); const error = page.locator(".ow-error[role=alert]"); await expect(error).toBeVisible(); await expect(error).not.toContainText("Synthetic private diagnostic"); expect(downloads).toBe(0); expect(requests).toBe(1);
    const downloadEvent = page.waitForEvent("download"); await page.getByRole("button", { name: "Tresenschild laden", exact: true }).click(); const download = await downloadEvent; expect(download.suggestedFilename()).toBe("anmeldeschild.html"); const file = await download.path(); expect(file).not.toBeNull(); const html = await readFile(file!, "utf8"); expect(html).toContain(name); expect(html).toContain(`${origin}/join/${merchant.programSlug}`); expect(html).toContain("</svg>"); expect(requests).toBe(2); expect(downloads).toBe(1); await expect(error).toHaveCount(0);
    for (const table of ["memberships", "ledger_entries", "outbox_jobs"]) expect((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id=$1`, [merchant.tenantId])).rows[0].n).toBe(0);
  } finally { await context.close(); }
});
