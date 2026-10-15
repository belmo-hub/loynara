import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string; ownerPassword: string };

// On phones the bottom bar is fixed above the page. A dirty form's save bar sticks above it, so a tap on "save" reaches
// the save button and not a navigation tab underneath.
test("the save button of a dirty form is tappable above the bottom bar", async ({ page }) => {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  expect((await page.request.post("/api/auth/sign-in/email", { data: { email: demo.ownerEmail, password: demo.ownerPassword }, headers: { Origin: origin } })).ok()).toBe(true);
  await page.goto("/merchant/program/card");
  const name = page.getByLabel("Geschäftsname", { exact: true });
  await name.fill(`${await name.inputValue()} Test`);
  const save = page.getByRole("button", { name: "Kundenkarte speichern" });
  await expect(save).toBeEnabled();
  const hit = await save.evaluate(button => {
    const box = button.getBoundingClientRect();
    const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { onButton: Boolean(target && button.contains(target)), inViewport: box.bottom <= innerHeight };
  });
  expect(hit).toEqual({ onButton: true, inViewport: true });
});
