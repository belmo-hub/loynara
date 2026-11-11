import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string; ownerPassword: string };

/** The share of pixels that are dark in the frame and light on the settled screen: what a screen fading in cannot make. */
const foreignShare = (helper: Page, frame: Buffer, settled: Buffer) => helper.evaluate(async ([first, second]) => {
  const pixels = async (png: string) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = Object.assign(document.createElement("canvas"), { width: image.width, height: image.height });
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, image.width, image.height).data;
  };
  const [shown, rest] = [await pixels(first), await pixels(second)];
  let foreign = 0;
  for (let index = 1; index < shown.length; index += 4) if (shown[index] < 150 && rest[index] > 200) foreign++;
  return foreign / (shown.length / 4);
}, [frame.toString("base64"), settled.toString("base64")]);

const tab = (page: Page, name: string) => page.getByRole("navigation", { name: "Bereiche" }).getByRole("link", { name, exact: true });
async function openOwner(page: Page) {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  expect((await page.request.post("/api/auth/sign-in/email", { data: { email: demo.ownerEmail, password: demo.ownerPassword }, headers: { Origin: origin } })).ok()).toBe(true);
  await page.goto("/merchant");
}
/** One whole screen change, to its end. WebKit keeps a finished layer animation after it, so only unfinished ones count. */
async function toCustomers(page: Page) {
  await tab(page, "Kunden").click();
  await expect(page.getByRole("heading", { name: "Kundenkarten", level: 1 })).toBeVisible();
  await page.waitForFunction(() => !document.getAnimations().some(animation => animation.playState !== "finished" && (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition")));
}

// ENG-219: on iPhones the old screen lay over the new one for the whole screen change. WebKit does not paint the old
// screen's fade from the second change in a document on and draws it as styled at rest. The styles and the animations
// report the right values, so only pixels show it: the second change is frozen near its end, where the old screen's
// fade is over, and compared with the settled screen.
test("in the second screen change the old screen is not painted over the new one", async ({ page, browser }) => {
  await openOwner(page);
  const layers = (act: "pause" | "finish") => page.evaluate(step => {
    for (const animation of document.getAnimations()) {
      if (!(animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition")) continue;
      if (step === "finish") animation.finish(); else { animation.pause(); animation.currentTime = 200; }
    }
  }, act);
  const changing = () => document.getAnimations().some(animation => (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition-new("));

  await toCustomers(page);
  await tab(page, "Programm").click();
  await page.waitForFunction(changing);
  await layers("pause");
  // The new screen's own arrival runs on under the frozen change; it is over well within this.
  await page.waitForTimeout(700);
  const frozen = await page.screenshot();
  await layers("finish");
  await expect(page.getByRole("heading", { name: "Programm", level: 1 })).toBeVisible();
  await page.waitForTimeout(700);
  const settled = await page.screenshot();

  const helper = await browser.newPage();
  const share = await foreignShare(helper, frozen, settled);
  await helper.close();
  // The old screen over the new one measured 2.8 % of the phone's pixels; a clean change measures none.
  expect(share, "share of the screen that shows something the settled screen does not").toBeLessThan(0.002);
});

// ENG-219: WebKit keeps a finished layer animation after a change. The shell took that for a running change and
// swallowed every later tap on the content, replaying it by script: a text field then got focus without a tap of its own.
test("after a screen change has ended a tap on the content is the browser's own", async ({ page }) => {
  await openOwner(page);
  await toCustomers(page);
  await page.evaluate(() => document.addEventListener("click", event => { document.body.dataset.tap = String(event.isTrusted); }, { once: true }));
  await page.getByPlaceholder("Kartennummer suchen").click();
  await expect(page.locator("body"), "the tap reaches the page as the browser's own click").toHaveAttribute("data-tap", "true");
});
