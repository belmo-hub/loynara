import { expect, test, type Page } from "@playwright/test";

const ref = "abcdefghijklmnopqrstuvwx", requestId = "12345678-1234-1234-1234-123456789abc";
const tapPath = `/api/tap/${ref}`;
const preview = { merchantName: "Synthetic café", locationName: "Counter", programName: "Stamps", programSlug: "synthetic", brandColor: "#214739", mode: "staff_confirmed", hasMembership: true };
const pending = { state: "pending_staff", balance: 0, requestId, expiresAt: "2026-10-09T12:05:00.000Z", cardLocator: "K-ABC234" };

async function open(page: Page, baseURL: string, waiting: typeof pending & { statusRef?: string } = pending) {
  await page.clock.install({ time: new Date("2026-10-09T12:00:00Z") });
  // Network doubles exercise the real browser component; submitting a second POST must not disguise a status-read failure.
  let posts = 0;
  await page.route(`**${tapPath}?*`, route => {
    if (route.request().method() === "GET") return route.fulfill({ json: preview });
    posts += 1;
    return route.fulfill(posts === 1 ? { json: waiting } : { status: 400, json: { code: "INVALID_TAP", error: "No second submission" } });
  });
  await page.goto(`${baseURL}/tap/${ref}?e=${"0".repeat(32)}&c=${"0".repeat(16)}`);
  await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
}

test("a rate-limited waiting read respects Retry-After and eventually displays the cashier confirmation", async ({ page, baseURL }) => {
  let reads = 0;
  await page.route(`**${tapPath}/status/${requestId}`, route => {
    reads += 1;
    return route.fulfill(reads === 1 ? { status: 429, headers: { "Retry-After": "8" }, json: { code: "RATE_LIMIT", error: "Wait" } } : { json: { ...pending, state: "confirmed", balance: 1 } });
  });
  await open(page, baseURL!);
  await page.clock.runFor(4000);
  await expect.poll(() => reads).toBe(1);
  await page.clock.runFor(7000);
  await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
  await page.clock.runFor(1000);
  await expect(page.getByRole("heading", { name: "Stempel erhalten" })).toBeVisible();
  await page.clock.runFor(20_000);
  expect(reads).toBe(2);
});

test("a disconnected waiting read retries and resolves server expiry", async ({ page, baseURL }) => {
  let reads = 0;
  await page.route(`**${tapPath}/status/${requestId}`, route => {
    reads += 1;
    return reads === 1 ? route.abort("internetdisconnected") : route.fulfill({ json: { state: "expired", balance: 0 } });
  });
  await open(page, baseURL!);
  await page.clock.runFor(4000);
  await expect.poll(() => reads).toBe(1);
  await page.clock.runFor(4000);
  await expect(page.getByRole("heading", { name: "Anfrage abgelaufen" })).toBeVisible();
});

test("an initial submit rejection still offers the QR fallback", async ({ page, baseURL }) => {
  await page.route(`**${tapPath}?*`, route => route.fulfill(route.request().method() === "GET" ? { json: preview } : { status: 429, json: { code: "RATE_LIMIT", error: "Wait" } }));
  await page.goto(`${baseURL}/tap/${ref}?e=${"0".repeat(32)}&c=${"0".repeat(16)}`);
  await expect(page.getByRole("heading", { name: "Zu viele Versuche" })).toBeVisible();
  await expect(page.getByText("Du kannst jederzeit stattdessen den QR-Code an der Kasse zeigen.")).toBeVisible();
});

test("a request attached by another tag polls the server-supplied request reference", async ({ page, baseURL }) => {
  const canonical = "ABCDEFGHIJKLMNOPQRSTUVWX";
  await page.route(`**/api/tap/${canonical}/status/${requestId}`, route => route.fulfill({ json: { ...pending, state: "confirmed", balance: 1 } }));
  await open(page, baseURL!, { ...pending, statusRef: canonical });
  await page.clock.runFor(4000);
  await expect(page.getByRole("heading", { name: "Stempel erhalten" })).toBeVisible();
});
