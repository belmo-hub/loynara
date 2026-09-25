import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, expect, test, type Page } from "@playwright/test";

type DemoAccess = { cashierEmail: string; cashierPassword: string };

async function signInCashier(page: Page) {
  const access = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as DemoAccess;
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(access.cashierEmail);
  await page.getByLabel("Passwort").fill(access.cashierPassword);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/cashier");
}

test("camera errors explain permission, busy device, and missing camera with retry and manual fallback", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { cameraFailure: string }).cameraFailure = "NotAllowedError";
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException("synthetic camera failure", (window as unknown as { cameraFailure: string }).cameraFailure);
        },
      },
    });
  });
  await signInCashier(page);
  await page.getByRole("button", { name: "Kamera öffnen" }).click();
  await expect(page.locator(".scanner-content p[role=alert]")).toContainText("Kamerazugriff abgelehnt");
  await page.evaluate(() => { (window as unknown as { cameraFailure: string }).cameraFailure = "NotReadableError"; });
  await page.getByRole("button", { name: "Kamera erneut versuchen" }).click();
  await expect(page.locator(".scanner-content p[role=alert]")).toContainText("Kamera ist belegt");
  await page.evaluate(() => { (window as unknown as { cameraFailure: string }).cameraFailure = "NotFoundError"; });
  await page.getByRole("button", { name: "Kamera erneut versuchen" }).click();
  await expect(page.locator(".scanner-content p[role=alert]")).toContainText("Keine Kamera gefunden");
  await page.getByRole("button", { name: "Code manuell eingeben" }).click();
  await expect(page.getByRole("dialog", { name: "QR-Code scannen" })).toHaveCount(0);
});

test("insecure context and absent camera API show a manual path", async ({ page }) => {
  await signInCashier(page);
  await page.evaluate(() => { Object.defineProperty(window, "isSecureContext", { configurable: true, value: false }); });
  await page.getByRole("button", { name: "Kamera öffnen" }).click();
  await expect(page.locator(".scanner-content p[role=alert]")).toContainText("sichere HTTPS-Seite oder localhost");
  await page.getByRole("button", { name: "Code manuell eingeben" }).click();
  await page.evaluate(() => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
  });
  await page.getByRole("button", { name: "Kamera öffnen" }).click();
  await expect(page.locator(".scanner-content p[role=alert]")).toContainText("bietet keine Kamera");
  await page.getByRole("button", { name: "Code manuell eingeben" }).click();
  await expect(page.getByLabel("Kartencode manuell eingeben")).toBeVisible();
});

test("fake camera stream stops on restart and close; no real hardware is used", async ({ baseURL }) => {
  const browser = await chromium.launch({ channel: "chrome", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const url = baseURL ?? "http://localhost:3000";
  const context = await browser.newContext({ baseURL: url });
  await context.grantPermissions(["camera"], { origin: new URL(url).origin });
  try {
    const page = await context.newPage();
    await signInCashier(page);
    await page.getByRole("button", { name: "Kamera öffnen" }).click();
    await expect(page.getByRole("status")).toContainText("Halte den QR-Code vollständig in den Rahmen.");
    const firstTrack = await page.locator(".scanner-video-wrap video").evaluate(video => {
      const track = ((video as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0];
      (window as unknown as { firstCameraTrack: MediaStreamTrack }).firstCameraTrack = track;
      return track.readyState;
    });
    expect(firstTrack).toBe("live");

    await page.getByRole("button", { name: "Kamera neu starten" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { firstCameraTrack: MediaStreamTrack }).firstCameraTrack.readyState)).toBe("ended");
    await expect(page.getByRole("status")).toContainText("Halte den QR-Code vollständig in den Rahmen.");
    await page.locator(".scanner-video-wrap video").evaluate(video => {
      (window as unknown as { secondCameraTrack: MediaStreamTrack }).secondCameraTrack = ((video as HTMLVideoElement).srcObject as MediaStream).getVideoTracks()[0];
    });
    await page.getByRole("button", { name: "Kamera schließen" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { secondCameraTrack: MediaStreamTrack }).secondCameraTrack.readyState)).toBe("ended");
  } finally {
    await context.close();
    await browser.close();
  }
});
