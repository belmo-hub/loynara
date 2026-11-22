import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string; ownerPassword: string };

/** The share of pixels that are dark in the frame and light on the settled screen: what a screen fading in cannot make. */
const foreignShare = (helper: Page, frame: Buffer, settled: Buffer, dark = 150) => helper.evaluate(async ([first, second, cutoff]) => {
  const pixels = async (png: string) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    await image.decode();
    const canvas = Object.assign(document.createElement("canvas"), { width: image.width, height: image.height });
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return { data: context.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height };
  };
  const [{ data: shown, width, height }, { data: rest }] = [await pixels(first), await pixels(second)];
  // Dark in the frame and no dark pixel within 2 px on the settled screen: an edge drawn a pixel off is not foreign.
  const lightAround = (x: number, y: number) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const [nx, ny] = [x + dx, y + dy];
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && rest[(ny * width + nx) * 4 + 1] <= 200) return false;
    }
    return true;
  };
  let foreign = 0;
  for (let index = 1; index < shown.length; index += 4) if (shown[index] < Number(cutoff) && lightAround(((index - 1) / 4) % width, Math.floor((index - 1) / 4 / width))) foreign++;
  return foreign / (shown.length / 4);
}, [frame.toString("base64"), settled.toString("base64"), dark] as const);

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
// fade has all but run out, and compared with the settled screen.
test("in the second screen change the old screen is not painted over the new one", async ({ page, browser }) => {
  await openOwner(page);
  const layers = (act: "pause" | "finish") => page.evaluate(step => {
    for (const animation of document.getAnimations()) {
      if (!(animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition")) continue;
      if (step === "finish") animation.finish(); else { animation.pause(); animation.currentTime = 115; } // 5 ms before the 120 ms fade ends
    }
  }, act);
  const changing = () => document.getAnimations().some(animation => (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition-old("));

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

// ENG-221: WebKit painted the fades only in the first change after a load; from the second on the old screen cut away
// at once and the new one popped in. Slowed down tenfold, the old screen must still show while the second change runs.
test("in the second screen change the old screen fades out instead of cutting away", async ({ page, browser }) => {
  await openOwner(page);
  await page.addStyleTag({ content: ":root { --dur-press: 1200ms !important; --dur-ui: 2200ms !important; }" });
  await toCustomers(page);
  await tab(page, "Programm").click();
  await page.waitForFunction(() => document.getAnimations().some(animation => (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition-old(")));
  const frames = [await page.screenshot(), await page.screenshot(), await page.screenshot()];
  await expect(page.getByRole("heading", { name: "Programm", level: 1 })).toBeVisible();
  await page.waitForFunction(() => !document.getAnimations().some(animation => animation.playState !== "finished" && (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition")));
  const settled = await page.screenshot();
  const helper = await browser.newPage();
  const shares = [];
  // The old screen leaves from 40 %, so its dark text is drawn at about 156 of 255 over the light ground: dark is < 200 here.
  for (const frame of frames) shares.push(await foreignShare(helper, frame, settled, 200));
  await helper.close();
  // The fading Kundenkarten page leaves dark text where the settled Programm page is light; a cut leaves none.
  expect(Math.max(...shares), "the old screen is still drawn while its fade runs").toBeGreaterThan(0.005);
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
