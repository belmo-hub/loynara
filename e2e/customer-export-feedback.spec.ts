import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { pool } from "../src/db";
import { nfcFixture } from "../src/lib/nfc-test-db";
import { award } from "../src/lib/loyalty";
import { closeCard } from "../src/lib/card-lifecycle";

// No signup or limiter reset: create only disposable synthetic fixtures through
// the existing test helper and exercise the real card/export HTTP contracts.
const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(database.hostname) ||
    database.port !== "55433" || !/^\/looplocal_browser_export_[a-z0-9]+$/.test(database.pathname)) throw new Error("Dedicated synthetic export database required");
test.afterAll(async () => { await pool.end(); });

for (const width of [375, 1280]) for (const failure of ["server", "incomplete", "network", "revoked"] as const) {
  test(`customer export refuses ${failure} failure and retains usable feedback (${width}px)`, async ({ browser, baseURL }) => {
    const url = baseURL ?? "http://localhost:3000";
    if (url !== "http://localhost:3000") throw new Error("Synthetic loopback application required");
    const own = await nfcFixture({ tapMode: "disabled" });
    const foreign = await nfcFixture({ tapMode: "disabled" });
    await award({ userId: own.userId, locationId: own.location.id, membershipId: own.member.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await award({ userId: foreign.userId, locationId: foreign.location.id, membershipId: foreign.member.id, quantity: 3, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const context = await browser.newContext({ baseURL: url, viewport: { width, height: 812 }, acceptDownloads: true });
    try {
      const page = await context.newPage();
      await page.goto(`/card/${own.member.cardToken}`);
      await expect(page.locator(".customer-card")).toContainText("Tap Test Café");
      const exportPath = `/api/card/${own.member.cardToken}/export`;
      const exportLink = page.locator(`a[href="${exportPath}"]`);
      const feedback = page.getByRole("alert").filter({ hasText: /Der Export|Dieser Kartenlink|Zu viele Exportversuche/ });
      const downloads: string[] = []; let requests = 0;
      page.on("download", download => { downloads.push(download.suggestedFilename()); });
      page.on("request", request => { if (new URL(request.url()).pathname === exportPath) requests++; });
      if (failure === "revoked") {
        await closeCard(own.member.cardToken);
        const rejection = await context.request.get(exportPath);
        expect(rejection.status()).toBe(404);
        expect(await rejection.json()).toMatchObject({ code: "NOT_FOUND" });
      }
      else await page.route(`**${exportPath}`, async route => {
        if (failure === "network") await route.abort("connectionreset");
        else await route.fulfill({ status: failure === "server" ? 503 : 200, contentType: "application/json", body: failure === "server" ? JSON.stringify({ error: "Synthetic private diagnostic must not reach feedback" }) : '{"formatVersion":1,"membership":' });
      });
      await exportLink.focus(); await page.keyboard.press("Enter");
      await expect(feedback).toBeVisible();
      expect(requests).toBe(1);
      await expect(feedback).toContainText(failure === "revoked" ? "Kartenlink" : failure === "server" ? "nicht verfügbar" : "nicht vollständig");
      expect(downloads).toEqual([]);
      if (failure === "server" && width === 375) await page.screenshot({ path: "/tmp/loy-063-error-mobile.png", fullPage: true });
      await expect(exportLink).not.toHaveAttribute("aria-disabled", "true");
      await expect(page).toHaveURL(`${url}/card/${own.member.cardToken}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const visibleError = await feedback.innerText();
      expect(visibleError).not.toContain(own.member.cardToken);
      expect(visibleError).not.toContain("Synthetic private diagnostic");
      const foreignExport = await context.request.get(`/api/card/${foreign.member.cardToken}/export`);
      expect(foreignExport.status()).toBe(200);
      expect((await foreignExport.json()).membership).toMatchObject({ id: foreign.member.id, balance: 3 });
      if (failure === "revoked") {
        const denied = await context.request.get(exportPath);
        expect(denied.status()).toBe(404);
        expect(await denied.json()).toMatchObject({ code: "NOT_FOUND" });
      } else {
        await page.unroute(`**${exportPath}`);
        const downloaded = page.waitForEvent("download");
        await exportLink.focus(); await page.keyboard.press("Enter");
        const download = await downloaded;
        expect(download.suggestedFilename()).toBe("loynara-card-export.json");
        const result = JSON.parse(await readFile((await download.path())!, "utf8"));
        expect(result).toMatchObject({ formatVersion: 1, scope: "pseudonymous-card-activity-without-contact-records", membership: { id: own.member.id, balance: 2 }, ledger: [{ delta: 2 }], redemptions: [], consentEvents: [] });
        const serialized = JSON.stringify(result);
        for (const excluded of [foreign.member.id, own.member.cardToken, own.member.scanCode, foreign.member.cardToken]) expect(serialized).not.toContain(excluded);
        await expect(feedback).toHaveCount(0);
        expect(downloads).toEqual(["loynara-card-export.json"]);
        expect(requests).toBe(2);
      }
    } finally { await context.close(); }
  });
}
