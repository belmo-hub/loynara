import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

for (const width of [375, 1280]) for (const reducedMotion of ["reduce", "no-preference"] as const) {
  test(`owner discard dialog respects ${reducedMotion} at ${width}px`, async ({ browser, baseURL }) => {
    const url = baseURL ?? "http://localhost:3000";
    const api = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
    try {
      expect((await api.post("/api/auth/sign-up/email", { data: {
        name: "Synthetic motion owner", email: `motion-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa`,
      } })).status()).toBe(200);
      expect((await api.post("/api/merchant/onboard", { data: {
        businessName: "Synthetic Motion Café", locationName: "Erster Standort", city: "Kassel", country: "DE",
        timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Motion card", programType: "stamp",
        rulesText: "Ein Stempel je bestätigtem synthetischem Kassenvorgang.", rewardTitle: "Kaffee", rewardCost: 5,
      } })).status()).toBe(201);
      const context = await browser.newContext({ baseURL: url, storageState: await api.storageState(), viewport: { width, height: 812 }, reducedMotion });
      try {
        const page = await context.newPage();
        await page.goto("/merchant/program/card");
        await page.getByLabel("Geschäftsname").fill("Synthetic Motion Neu");
        if (width === 375) await page.getByRole("button", { name: "Navigation öffnen" }).click();
        await page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Übersicht" }).click();
        const dialog = page.getByRole("dialog", { name: "Ungespeicherte Änderungen verwerfen?" });
        await expect(dialog).toBeVisible();
        const motion = await dialog.evaluate(el => {
          const style = getComputedStyle(el);
          return { reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
            duration: parseFloat(style.animationDuration), animation: style.animationName,
            transform: style.transform, running: el.getAnimations().filter(a => a.playState === "running").length };
        });
        console.log(JSON.stringify({ width, reducedMotion, motion }));
        expect(motion.reduced).toBe(reducedMotion === "reduce");
        if (reducedMotion === "reduce") expect(motion.duration).toBeLessThanOrEqual(0.001);
        else expect(motion.duration).toBe(0.22);
        const keep = dialog.getByRole("button", { name: "Weiter bearbeiten" });
        await keep.focus();
        await page.keyboard.press("Enter");
        await expect(dialog).toHaveCount(0);
        // Cancellation retains the existing edit and communicates its unsaved state.
        await expect(page.getByLabel("Geschäftsname")).toHaveValue("Synthetic Motion Neu");
        await expect(page.getByText("Ungespeicherte Änderungen", { exact: true })).toBeVisible();
      } finally { await context.close(); }
    } finally { await api.dispose(); }
  });
}
