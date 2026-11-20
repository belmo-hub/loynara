import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, request as apiRequest, test, type Page } from "@playwright/test";
import { signUp } from "./support/sign-up";

// The screen change in the owner area (DESIGN.md, Motion): the old screen fades out over --dur-press, the new one stands
// at full from the first frame, the bars stay.
const access = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string; ownerPassword: string };

// One sign-in for the file: the login limit counts every attempt.
test.describe.configure({ mode: "serial" });
let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(access.ownerEmail);
  await page.getByLabel("Passwort").fill(access.ownerPassword);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL("/merchant");
});
test.afterAll(() => page.close());
test.beforeEach(async () => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/merchant");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

const tab = (name: string) => page.getByRole("navigation", { name: "Bereiche" }).getByRole("link", { name, exact: true });
const inLayer = (prefix: string, running = false) => page.evaluate(([start, mustRun]) => document.getAnimations().some(animation => (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith(start as string) && (!mustRun || animation.playState === "running")), [prefix, running] as const);
/** The layers of the screens, not those of the bars or the hidden root. */
const SCREEN = /^::view-transition-(old|new)\((?!root\)|ow-topbar\)|ow-subnav\)|ow-tabs\))/;
/** Resolves in the frame in which the outgoing screen's fade exists. */
const fadeStarted = () => page.waitForFunction(() => document.getAnimations().some(animation => (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition-old(") && !/\((root|ow-topbar|ow-subnav|ow-tabs)\)/.test((animation.effect as KeyframeEffect).pseudoElement!)));
/** From the next frame on, until the change ends: in every frame, the opacity of each screen layer. */
const watchLayers = () => page.evaluate(source => new Promise<{ old: number[]; new: number[]; block: number | null; card: boolean }[]>(done => {
  const screen = new RegExp(source);
  const frames: { old: number[]; new: number[]; block: number | null; card: boolean }[] = [];
  let seen = false;
  const look = () => {
    const old = document.getAnimations().map(animation => (animation.effect as KeyframeEffect | null)?.pseudoElement ?? "").filter(layer => layer.startsWith("::view-transition-old(") && screen.test(layer));
    const active = CSS.supports("selector(:active-view-transition)") ? document.documentElement.matches(":active-view-transition") : old.length > 0;
    if (active) {
      // A new screen has no animation, so its layers are found by the names its elements carry during the change.
      const names = [...document.querySelectorAll<HTMLElement>(".ow-content, .ow-content *")].map(node => getComputedStyle(node).viewTransitionName).filter(name => name && name !== "none");
      seen = true;
      const block = document.querySelector(".ow-content [data-arrive]");
      frames.push({ old: old.map(layer => Number(getComputedStyle(document.documentElement, layer).opacity)), new: names.map(name => Number(getComputedStyle(document.documentElement, `::view-transition-new(${name})`).opacity)), block: block ? Number(getComputedStyle(block).opacity) : null, card: old.some(layer => layer.includes("(ow-card)")) || document.getAnimations().some(animation => (animation.effect as KeyframeEffect | null)?.pseudoElement?.includes("(ow-card)")) });
    } else if (seen) { done(frames); return; }
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}), SCREEN.source);
// WebKit keeps a finished layer animation after a change (#263), so only unfinished ones count.
const settled = () => page.waitForFunction(() => !document.getAnimations().some(animation => animation.playState !== "finished" && (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition")));

test("a step in fades to the end: a page that swaps its loading frame for its form does not cut the change short", async () => {
  await tab("Programm").click();
  await expect(page.getByRole("heading", { name: "Programm", level: 1 })).toBeVisible();
  await settled();
  // A change cut short cancels its fade; one that runs out finishes it.
  const ran = page.evaluate(() => new Promise<boolean>(done => {
    const look = () => {
      const fade = document.getAnimations().find(animation => /^::view-transition-old\((?!root\)|ow-topbar\)|ow-subnav\)|ow-tabs\))/.test((animation.effect as KeyframeEffect | null)?.pseudoElement ?? ""));
      if (fade) fade.finished.then(() => done(true), () => done(false)); else requestAnimationFrame(look);
    };
    look();
  }));
  // Every title the document takes after the tap. The page's metadata later puts the site's title back (a known fault of
  // its own), so the test asks whether the screen named itself, not what the title is at the end.
  await page.evaluate(() => {
    const titles: string[] = [];
    (window as unknown as { titles: string[] }).titles = titles;
    new MutationObserver(() => titles.push(document.title)).observe(document.head, { childList: true, subtree: true, characterData: true });
  });
  await page.getByRole("link", { name: /Prämie hinzufügen/ }).click();
  await expect(page).toHaveURL(/\/merchant\/program\/rewards\/new$/);
  await expect.poll(() => page.evaluate(() => (window as unknown as { titles: string[] }).titles.some(title => / – Loynara$/.test(title) && !title.startsWith("Programm"))), { message: "the new screen names itself to assistive tech" }).toBe(true);
  expect(await ran, "the old screen's fade ran to its end").toBe(true);
});

// ENG-219: WebKit (every iPhone browser) does not always paint the old screen's fade and then draws it as styled at
// rest for the whole change. At rest it must be invisible, in every browser, so it can never lie over the new screen.
test("the old screen is invisible at rest: only its running fade shows it", async () => {
  await tab("Programm").click();
  await fadeStarted();
  const rest = await page.evaluate(() => document.getAnimations().flatMap(animation => {
    const layer = (animation.effect as KeyframeEffect | null)?.pseudoElement ?? "";
    if (!/^::view-transition-old\((?!root\)|ow-topbar\)|ow-subnav\)|ow-tabs\))/.test(layer)) return [];
    animation.cancel();
    return [getComputedStyle(document.documentElement, layer).opacity];
  }));
  expect(rest.length, "the old screen is a layer of the change").toBeGreaterThan(0);
  expect(rest, "the old screen's opacity without its fade").toEqual(rest.map(() => "0"));
});

// ENG-221: WebKit paints the fades only under keyframe names the last change did not use, so the changes alternate two
// identical pairs. The pixels are checked in WebKit (owner-screen-change.mobile.spec.ts); here the alternation.
test("each screen change takes the other pair of keyframes", async () => {
  const names = async () => {
    await fadeStarted();
    // The screens' fades; a card's own pair has its own names (the card tests).
    const used = await page.evaluate(source => document.getAnimations().flatMap(animation => { const layer = (animation.effect as KeyframeEffect | null)?.pseudoElement ?? ""; return new RegExp(source).test(layer) && !layer.includes("(ow-card)") ? [(animation as CSSAnimation).animationName] : []; }), SCREEN.source);
    await settled();
    return [...new Set(used)].sort().join(" ");
  };
  await tab("Programm").click();
  const first = await names();
  await tab("Kunden").click();
  const second = await names();
  await tab("Programm").click();
  const third = await names();
  expect([first, second].sort(), "two changes in a row use both names").toEqual(["ow-fade-out", "ow-fade-out-b"]);
  expect(third, "the third change takes the first pair again").toBe(first);
  // A customer card opens and closes on the same path: those are changes of their own too.
  await page.goto("/merchant/customers?activity=all");
  const row = page.locator('section[aria-labelledby="cu-h"] a.ow-prog-row').first();
  await expect(row).toBeVisible();
  await settled();
  const before = await page.evaluate(() => document.documentElement.hasAttribute("data-ow-fade"));
  await row.click();
  const opened = await names();
  await page.locator(".ow-content a.ow-back:visible").click();
  const closed = await names();
  expect(opened, "opening a card takes the pair the list did not").toBe(before ? "ow-fade-out" : "ow-fade-out-b");
  expect(closed, "closing it takes the other one").not.toBe(opened);
});

test("a tab opens its screen at the top, also after a little scrolling; going back returns to the place left", async () => {
  // Next.js keeps the offset when the new page's top still counts as in view; on iPhone Safari that left the heading under
  // the bar. Without the bars' scroll padding Chrome takes the same branch, so the shell's own reset is what is tested.
  const padding = await page.addStyleTag({ content: "html:root { scroll-padding-top: 0 !important; }" });
  await page.evaluate(() => window.scrollTo({ top: 20, behavior: "instant" }));
  await tab("Programm").click();
  await expect(page.getByRole("heading", { level: 1, name: "Programm" })).toBeVisible();
  await settled();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await padding.evaluate(node => (node as Element).remove());

  const row = page.locator('.ow-content a[href^="/merchant/program/"]').last();
  await row.scrollIntoViewIfNeeded();
  const left = await page.evaluate(() => Math.round(window.scrollY));
  expect(left).toBeGreaterThan(100);
  await row.click();
  await expect(page.getByRole("heading", { level: 1, name: "Programm" })).toBeHidden();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Programm" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(left);
});

/** Takes the bars' scroll padding away: Next.js then keeps a small offset on a change, as iPhone Safari did. */
const withoutPadding = () => page.addStyleTag({ content: "html:root { scroll-padding-top: 0 !important; }" });
const y = () => page.evaluate(() => Math.round(window.scrollY));

test("a back link opens its screen at the top too", async () => {
  await withoutPadding();
  await tab("Aktionen").click();
  await page.locator(".ow-content a.ow-prog-row").filter({ hasText: "Kampagnen" }).click();
  await expect(page).toHaveURL(/\/merchant\/campaigns/);
  await settled();
  await page.evaluate(() => window.scrollTo({ top: 20, behavior: "instant" }));
  await page.locator(".ow-content a.ow-back:visible").click();
  await expect(page.getByRole("heading", { level: 1, name: "Aktionen" })).toBeVisible();
  await settled();
  expect(await y(), "„‹ Aktionen“ after 20 px of scrolling").toBe(0);
});

test("„‹ Programm“ returns to the row it was left from", async () => {
  await tab("Programm").click();
  await settled();
  // The whole list is there once its side reads are in (the reminder row needs them); then its last row is furthest down.
  await expect(page.locator('.ow-content a[href^="/merchant/program/"]').filter({ hasText: "Erinnerung vor der Prämie" })).toBeAttached();
  const last = page.locator('.ow-content a[href^="/merchant/program/"]').last();
  // The list swaps its first rows once the side reads are in; scrolling waits until the row stays put.
  await expect(async () => { await last.scrollIntoViewIfNeeded({ timeout: 500 }); }).toPass();
  expect(await y()).toBeGreaterThan(100);
  const href = await last.getAttribute("href");
  await last.click();
  await expect(page.getByRole("heading", { level: 1, name: "Programm" })).toBeHidden();
  await settled();
  await page.locator(".ow-content a.ow-back:visible").click();
  await expect(page.getByRole("heading", { level: 1, name: "Programm" })).toBeVisible();
  // Programm puts the row back in view by itself, clear of the bars, and gives it the focus.
  const row = page.locator(`.ow-content a[href="${href}"]`);
  await expect(row).toBeFocused();
  await expect(row).toBeInViewport({ ratio: 1 });
  expect(await y(), "not the page's top").toBeGreaterThan(100);
});

test("Enter on a focused tab opens its screen at the top and keeps the focus on the tab", async () => {
  await withoutPadding();
  await page.evaluate(() => window.scrollTo({ top: 20, behavior: "instant" }));
  await tab("Programm").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Programm" })).toBeVisible();
  await settled();
  expect(await y()).toBe(0);
  await expect(tab("Programm")).toBeFocused();
});

test("a push to a section of a page lands on that section, not at the page's top", async () => {
  await page.goto("/merchant/automations");
  await page.getByRole("link", { name: "Absender eintragen" }).click();
  await expect(page).toHaveURL(/\/merchant\/settings#absender$/);
  await settled();
  // On a short page the section cannot reach the bars: the page then stands at its end with the section in view, and no
  // empty space is added below to make room (Design, 13 Nov).
  await expect.poll(() => page.evaluate(() => {
    const bars = Math.max(...[...document.querySelectorAll(".ow-topbar, .ow-subnav")].map(bar => bar.getBoundingClientRect().bottom));
    const top = document.getElementById("absender")!.getBoundingClientRect().top;
    const atEnd = document.documentElement.scrollHeight - window.innerHeight - window.scrollY <= 2;
    return Math.abs(Math.round(top - bars)) <= 2 || (atEnd && top >= bars - 2 && top < window.innerHeight);
  }), { message: "the section's top sits at the bars, or the page is at its end with the section in view" }).toBe(true);
});

test("a second tab tap during the change lands", async () => {
  const customers = await tab("Kunden").boundingBox();
  await tab("Programm").click();
  await fadeStarted();
  // A raw tap at the tab's place: the bar is captured for the change and takes no hit tests while it runs.
  const [x, y] = [customers!.x + customers!.width / 2, customers!.y + customers!.height / 2];
  if (test.info().project.use.hasTouch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
  await expect(page).toHaveURL(/\/merchant\/customers$/);
  await expect(page.getByRole("heading", { name: "Kundenkarten", level: 1 })).toBeVisible();
});

test("on a slow connection the tapped tab looks current at once and the screen in view stays", async () => {
  let release = () => {};
  const held = new Promise<void>(done => { release = done; });
  await page.route(/\/merchant\/more(\?|$)/, async route => { await held; await route.continue(); });
  await tab("Mehr").click();
  await expect(tab("Mehr")).toHaveAttribute("data-pending", "true");
  await expect(tab("Mehr")).toHaveCSS("font-weight", "800");
  await expect(tab("Übersicht")).toHaveCSS("font-weight", "650");
  await expect(page).toHaveURL(/\/merchant$/);
  release();
  await expect(page).toHaveURL(/\/merchant\/more$/);
  await expect(tab("Mehr")).not.toHaveAttribute("data-pending", "true");
  await page.unroute(/\/merchant\/more(\?|$)/);
});

// ENG-294: by the page's own clock, from the finger down to the frame in which the tapped tab is drawn current.
test("a tapped tab looks current within 100 ms, before its screen has arrived", async () => {
  let release = () => {};
  const held = new Promise<void>(done => { release = done; });
  await page.route(/\/merchant\/customers(\?|$)/, async route => { await held; await route.continue(); });
  await page.evaluate(() => {
    const link = document.querySelector<HTMLElement>('.ow-tabs a[href="/merchant/customers"]')!;
    const timing = { down: 0, current: 0 };
    (window as unknown as { tabTiming: typeof timing }).tabTiming = timing;
    document.addEventListener("pointerdown", () => {
      timing.down = performance.now();
      const frame = () => { if (getComputedStyle(link).fontWeight === "800") timing.current = performance.now(); else requestAnimationFrame(frame); };
      requestAnimationFrame(frame);
    }, { capture: true, once: true });
  });
  await tab("Kunden").click();
  await page.waitForFunction(() => (window as unknown as { tabTiming: { current: number } }).tabTiming.current > 0);
  const { down, current } = await page.evaluate(() => (window as unknown as { tabTiming: { down: number; current: number } }).tabTiming);
  expect(current - down, "ms from the tap to the tab drawn current").toBeLessThan(100);
  release();
  await expect(page).toHaveURL(/\/merchant\/customers$/);
  await page.unroute(/\/merchant\/customers(\?|$)/);
});

test("on a slow connection a tapped row holds the selected look until its screen shows", async () => {
  await tab("Programm").click();
  await expect(page.getByRole("heading", { name: "Programm", level: 1 })).toBeVisible();
  await settled();
  let release = () => {};
  const held = new Promise<void>(done => { release = done; });
  await page.route(/\/merchant\/program\/rule(\?|$)/, async route => { await held; await route.continue(); });
  await page.getByRole("link", { name: /Regel auf der Karte/ }).click();
  await expect(page.locator('.ow-content a[href^="/merchant/program/"]:has([data-pending])')).toHaveCount(1);
  await expect(page.locator('.ow-content a[href^="/merchant/program/"]:has([data-pending])'), "the fill is visible, not only the mark").toHaveCSS("background-image", /gradient/);
  await expect(page).toHaveURL(/\/merchant\/program$/);
  release();
  await expect(page).toHaveURL(/\/merchant\/program\/rule$/);
  await page.unroute(/\/merchant\/program\/rule(\?|$)/);
});

test("two quick taps on a slow connection: only the tab tapped last looks pending", async () => {
  let release = () => {};
  const held = new Promise<void>(done => { release = done; });
  const slow = /\/merchant\/(program|customers)(\?|$)/;
  await page.route(slow, async route => { await held; await route.continue(); });
  await tab("Programm").click();
  await expect(tab("Programm")).toHaveAttribute("data-pending", "true");
  await tab("Kunden").click();
  await expect(page.locator(".ow-tabs [data-pending]")).toHaveCount(1);
  await expect(tab("Kunden")).toHaveAttribute("data-pending", "true");
  release();
  await expect(page).toHaveURL(/\/merchant\/customers$/);
  await page.unroute(slow);
});

test("opening a customer card and going back are screen changes; a filter is not", async () => {
  await page.goto("/merchant/customers?activity=all");
  const first = page.locator('section[aria-labelledby="cu-h"] a.ow-prog-row').first();
  await expect(first).toBeVisible();
  await settled();
  // Any layer of a change in the half second around the filter pick.
  const changed = page.evaluate(() => new Promise<boolean>(done => {
    let seen = false;
    const end = performance.now() + 500;
    const look = () => {
      seen ||= document.getAnimations().some(animation => (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition"));
      if (performance.now() < end) requestAnimationFrame(look); else done(seen);
    };
    look();
  }));
  await page.getByRole("group", { name: "Kartenstatus" }).getByRole("button", { name: "Aktiv" }).click();
  expect(await changed, "a filter stays in place").toBe(false);
  await expect(first).toBeVisible();

  await first.click();
  await fadeStarted();
  expect(await inLayer("::view-transition-old(ow-under)"), "the list leaves as the old screen").toBe(true);
  await expect(page).toHaveURL(/[?&]card=/);
  await settled();
  let listReads = 0;
  const count = (request: { url(): string }) => { if (request.url().includes("/api/merchant/customers?")) listReads++; };
  page.on("request", count);
  await page.locator(".ow-content a.ow-back:visible").click();
  await fadeStarted();
  expect(await page.evaluate(() => { const list = document.querySelector<HTMLElement>(".ow-under")!; return !list.hidden && getComputedStyle(list).viewTransitionName === "ow-under"; }), "the list comes back as the new screen").toBe(true);
  await settled();
  await expect(first).toBeVisible();
  page.off("request", count);
  expect(listReads, "the list stayed mounted under the card: it is not read again").toBe(0);
});

test("reduced motion: the change is a cut", async () => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await tab("Programm").click();
  await expect(page.getByRole("heading", { name: "Programm", level: 1 })).toBeVisible();
  expect(await inLayer("::view-transition", true)).toBe(false);
});

// ENG-298 (Design's option B): the crossfade showed both screens at half strength for about 160 ms. Now the new screen
// stands at full from the first frame and its blocks rise in, while the old one leaves from 40 % (Design, #314: from 100 %
// the first frame still showed both screens' texts over each other).
test("the old screen is never above 40 % while the new one is in place; the new one is at full", async () => {
  for (const name of ["Kunden", "Programm", "Kunden"]) {
    const frames = watchLayers();
    await tab(name).click();
    const seen = await frames;
    await settled();
    const fading = seen.filter(frame => frame.old.length && frame.block !== null);
    expect(fading.length, `${name}: frames with the old screen leaving over the new screen's first block`).toBeGreaterThan(0);
    expect(fading.filter(frame => Math.max(...frame.old) > 0.4 + 1e-6), `${name}: frames with the old screen's layer above 0.40`).toEqual([]);
    expect(seen.flatMap(frame => frame.new).every(value => value === 1), `${name}: the new screen is at full in every frame`).toBe(true);
    expect(seen.filter(frame => frame.card), `${name}: a tab change carries no card layer`).toEqual([]);
  }
  // The hidden root takes no fade of its own: in WebKit it kept the change alive for 250 ms after the old screen left.
  await tab("Mehr").click();
  await fadeStarted();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement, "::view-transition-old(root)").animationName)).toBe("none");
});

// ENG-299: a card opened from its Kunden row grows out of the row's thumbnail and shrinks back into it. Exactly one pair
// is named, only for those two changes; the card is there in the change's first frame; the address changes in place.
/** Every frame of the next change: its ow-card layers, whether the card's face is there, and whether a loading frame is. */
type Pair = { name: string; direction: string; blend: string[] };
type CardFrame = { card: string[]; face: boolean; loading: boolean; pair: Pair | null; pseudo: boolean; way: string | null; radius: number; width: number };
/** Every frame of the next change, also the frames its layers still paint after their animations have ended. */
const watchCard = () => page.evaluate(() => new Promise<CardFrame[]>(done => {
  const frames: CardFrame[] = [];
  const end = performance.now() + 3000;
  const root = document.documentElement;
  const told = CSS.supports("selector(:active-view-transition)");
  let seen = false;
  const look = () => {
    const layers = document.getAnimations().map(animation => (animation.effect as KeyframeEffect | null)?.pseudoElement ?? "").filter(layer => layer.startsWith("::view-transition"));
    if (layers.length || (told && root.matches(":active-view-transition"))) {
      seen = true;
      const corners = document.getAnimations().find(animation => (animation.effect as KeyframeEffect | null)?.pseudoElement === "::view-transition-image-pair(ow-card)") as CSSAnimation | undefined;
      const group = getComputedStyle(root, "::view-transition-group(ow-card)").width, pair = getComputedStyle(root, "::view-transition-image-pair(ow-card)");
      frames.push({ card: [...new Set(layers.filter(layer => layer.includes("(ow-card)")))], face: !!document.querySelector("[data-card-face]"), loading: !!document.querySelector(".ow-content [role=status][aria-busy=true]"),
        pair: corners ? { name: corners.animationName, direction: pair.animationDirection, blend: ["old", "new"].map(side => getComputedStyle(root, `::view-transition-${side}(ow-card)`).mixBlendMode) } : null,
        // A layer that is not there has no width of its own.
        pseudo: group !== "auto" && parseFloat(group) > 0, way: root.getAttribute("data-ow-card"), radius: parseFloat(pair.borderTopLeftRadius), width: parseFloat(group) });
    } else if (seen || performance.now() > end) { done(frames); return; }
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}));
const cardRow = () => page.locator('section[aria-labelledby="cu-h"] a.ow-prog-row').first();
async function toList() {
  await page.goto("/merchant/customers?activity=all");
  await expect(cardRow()).toBeVisible();
  await settled();
}

test("a card grows out of its row and shrinks back into it: one named pair, the card in the first frame, no server wait", async () => {
  await toList();
  const card = await page.evaluate(() => (document.querySelector('section[aria-labelledby="cu-h"] a.ow-prog-row') as HTMLAnchorElement).href);
  const reads: string[] = [];
  const note = (request: { url(): string }) => { if (request.url().includes("_rsc")) reads.push(request.url()); };
  page.on("request", note);
  let frames = watchCard();
  await cardRow().click();
  const open = await frames;
  page.off("request", note);
  await expect(page).toHaveURL(card);
  const growing = open.filter(frame => frame.card.length);
  expect(growing.length, "the card grows").toBeGreaterThan(0);
  expect([...new Set(growing.flatMap(frame => frame.card))].sort(), "one pair: the card's group, its corners, the thumbnail leaving and the card arriving").toEqual(["::view-transition-group(ow-card)", "::view-transition-image-pair(ow-card)", "::view-transition-new(ow-card)", "::view-transition-old(ow-card)"]);
  expect(growing.every(frame => frame.face && !frame.loading), "the card is painted from its row in every frame, with no loading frame in its place").toBe(true);
  expect(reads, "opening a card asks the server for nothing but its data").toEqual([]);
  expect(open.find(frame => frame.pair)?.pair, "the image pair carries the corners and the shadow forward; both images add up (plus-lighter)").toEqual({ name: expect.stringMatching(/^ow-card-corners(-b)?$/), direction: "normal", blend: ["plus-lighter", "plus-lighter"] });
  expect(open.filter(frame => frame.pseudo && frame.way !== "open"), "every frame with the card's layer is marked as an open").toEqual([]);
  await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute("data-ow-card")), { message: "the pair is named only for the change" }).toBe(false);
  await settled();

  frames = watchCard();
  await page.locator(".ow-content a.ow-back:visible").click();
  const back = await frames;
  expect(back.some(frame => frame.card.includes("::view-transition-group(ow-card)")), "the card shrinks into its row").toBe(true);
  expect(back.find(frame => frame.pair)?.pair, "the corners and the shadow go back to the thumbnail's on keyframes of their own, forward").toMatchObject({ name: expect.stringMatching(/^ow-card-corners-back(-b)?$/), direction: "normal" });
  // Design, #315 re-check: the last painted frame without "back" jumped to the card's corners and shadow on the thumbnail.
  expect(back.filter(frame => frame.pseudo && frame.way !== "back"), "every frame with the card's layer, the last one too, is marked as a back").toEqual([]);
  // The corners shrink with the box: never rounder than the box's width allows (8 px on the 64 px thumbnail, 28 on the card).
  const shrinking = back.filter(frame => frame.pseudo);
  const full = shrinking[0]!.width;
  expect(shrinking.filter(frame => frame.radius > 8 + 20 * Math.max(0, (frame.width - 64) / (full - 64)) + 1).map(frame => [frame.width, frame.radius]), "frames with corners rounder than the box's size").toEqual([]);
  await expect(cardRow()).toBeVisible();
  await settled();
  // A tab change from the list names no row.
  frames = watchCard();
  await tab("Programm").click();
  expect((await frames).flatMap(frame => frame.card), "a tab change has no card layer").toEqual([]);
});

test("Back with the card scrolled out of view is a plain screen change; browser Back is one too", async () => {
  await page.setViewportSize({ width: 390, height: 420 });
  try {
    await toList();
    await cardRow().click();
    await expect(page.locator("[data-card-face]")).toBeVisible();
    await settled();
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    expect(await page.evaluate(() => document.querySelector("[data-card-face]")!.getBoundingClientRect().top), "the card's top is above the screen").toBeLessThan(0);
    // The back link sits at the page's top, so a tap brings the card into view first; Enter from the keyboard does not.
    await page.evaluate(() => document.querySelector<HTMLElement>(".ow-content a.ow-back")!.focus({ preventScroll: true }));
    let frames = watchCard();
    await page.keyboard.press("Enter");
    expect((await frames).flatMap(frame => frame.card), "no shrink").toEqual([]);
    await expect(cardRow()).toBeVisible();
    await settled();
    // Next.js runs no view transition for the history's Back, here as on every owner screen.
    await cardRow().click();
    await expect(page.locator("[data-card-face]")).toBeVisible();
    await settled();
    frames = watchCard();
    await page.goBack();
    expect((await frames).flatMap(frame => frame.card), "browser Back: no shrink").toEqual([]);
    await expect(cardRow()).toBeVisible();
  } finally { await page.setViewportSize({ width: 390, height: 844 }); }
});

test("reduced motion: a card opens and closes with a cut", async () => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await toList();
  await cardRow().click();
  await expect(page.locator("[data-card-face]")).toBeVisible();
  expect(await inLayer("::view-transition-group(ow-card)", true)).toBe(false);
  await page.locator(".ow-content a.ow-back:visible").click();
  await expect(cardRow()).toBeVisible();
  expect(await inLayer("::view-transition", true)).toBe(false);
});

test("a points card opened from its row fills only once it has landed", async ({ browser }) => {
  const url = test.info().project.use.baseURL!;
  const owner = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  expect((await signUp(owner, { data: { name: "Synthetic card owner", email: `card-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  const setup = await owner.post("/api/merchant/onboard", { data: { businessName: "Synthetic Card Café", locationName: "Kassel Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
    programName: "Punktekarte", programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 1, rulesText: "Ein Punkt je vollem Euro an der Kasse.", rewardTitle: "Kuchen", rewardCost: 50 } });
  expect(setup.status()).toBe(201);
  const { programSlug } = await setup.json() as { programSlug: string };
  const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  expect((await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false } })).ok()).toBe(true);
  await guest.dispose();
  const context = await browser.newContext({ storageState: await owner.storageState(), viewport: { width: 390, height: 844 } });
  await owner.dispose();
  try {
    const shop = await context.newPage();
    await shop.goto("/merchant/customers?activity=all");
    const row = shop.locator('section[aria-labelledby="cu-h"] a.ow-prog-row').first();
    await expect(row).toBeVisible();
    await shop.waitForTimeout(500);
    await row.click();
    await expect(shop.locator("[data-card-face]")).toBeVisible();
    // The fill's growth waits for the card's own move, --dur-reward.
    const delays = await shop.evaluate(() => document.querySelector("[data-card-face]")!.getAnimations({ subtree: true }).flatMap(animation => /grow/.test((animation as CSSAnimation).animationName) ? [Number(animation.effect!.getTiming().delay)] : []));
    expect(delays, "the fill grows once, after the card has landed").toEqual([480]);
  } finally { await context.close(); }
});

// Design, #314: what takes a placeholder's place fades in from a floor of 40 %, never from nothing; a frame with neither
// placeholder nor content read as a blank screen.
test("content that takes a placeholder's place fades in from a floor: no frame shows neither", async () => {
  for (const [name, read] of [["Programm", /\/api\/program\//], ["Kunden", /\/api\/merchant\/customers\?/]] as const) {
    await page.goto("/merchant");
    await settled();
    let release = () => {};
    const held = new Promise<void>(done => { release = done; });
    await page.route(read, async route => { await held; await route.continue(); });
    await tab(name).click();
    await expect(page.locator(".ow-content :is(.ow-loading, .ow-skel)").first()).toBeVisible();
    await settled();
    // Every frame until 300 ms after the placeholder has gone (a slow runner answers late): is a placeholder there, and
    // how strong is the weakest outermost swap.
    const frames = page.evaluate(() => new Promise<{ placeholder: boolean; swap: number | null }[]>(done => {
      const seen: { placeholder: boolean; swap: number | null }[] = [];
      const limit = performance.now() + 3000;
      let gone = 0;
      const look = () => {
        const swaps = [...document.querySelectorAll(".ow-content [data-swap]")].filter(node => !node.parentElement?.closest("[data-swap]"));
        const placeholder = !!document.querySelector(".ow-content :is(.ow-skel, .ow-ph, .ow-board-ph, .ow-loading)");
        seen.push({ placeholder, swap: swaps.length ? Math.min(...swaps.map(node => Number(getComputedStyle(node).opacity))) : null });
        if (!placeholder && !gone) gone = performance.now();
        if ((gone && performance.now() - gone > 300) || performance.now() > limit) done(seen); else requestAnimationFrame(look);
      };
      look();
    }));
    release();
    const seen = await frames;
    await page.unroute(read);
    expect(seen.some(frame => frame.swap !== null), `${name}: the content is marked as taking the placeholder's place`).toBe(true);
    // Pin 1 (Design, #314 re-check): in the frame the placeholder leaves and every one after, the content is at 40 % or more.
    expect(seen.filter(frame => !frame.placeholder && (frame.swap === null || frame.swap < 0.4 - 1e-3)), `${name}: frames after the placeholder left with the content below 40 %`).toEqual([]);
  }
});

test("a modified or middle click on a row marks nothing: the next tab change has no card layer", async () => {
  await toList();
  for (const click of [{ modifiers: ["ControlOrMeta"] as const }, { modifiers: ["Shift"] as const }, { button: "middle" as const }]) {
    const opened = page.context().waitForEvent("page", { timeout: 3000 }).then(other => other.close()).catch(() => {});
    await cardRow().click({ ...click, modifiers: click.modifiers ? [...click.modifiers] : undefined });
    await opened;
    expect(await page.evaluate(() => [document.documentElement.hasAttribute("data-ow-card"), document.querySelectorAll("[data-opened]").length]), `${JSON.stringify(click)}: nothing marked`).toEqual([false, 0]);
    // Headless WebKit opens no other tab and follows the link here instead: back to the list for the next click.
    if (page.url().includes("card=")) await toList();
  }
  const frames = watchLayers();
  await tab("Programm").click();
  expect((await frames).filter(frame => frame.card), "the tab change carries no card layer").toEqual([]);
});

test("a card's own read starts at the tap, under the growth, not after it", async () => {
  await toList();
  await page.route(/\/api\/merchant\/customers\/[^?/]+$/, async route => { await new Promise(done => setTimeout(done, 120)); await route.continue(); });
  try {
    // By the page's clock: from the finger down to the card's read leaving. It waited out the growth (527 to 562 ms)
    // while React held passive effects; a server's own speed does not enter this measure.
    const left = page.evaluate(() => new Promise<number>(resolve => {
      document.addEventListener("pointerdown", () => {
        const down = performance.now();
        const fetch = window.fetch;
        window.fetch = (...args: Parameters<typeof window.fetch>) => {
          if (/\/api\/merchant\/customers\/[^?/]+$/.test(String(args[0] instanceof Request ? args[0].url : args[0]))) { resolve(performance.now() - down); window.fetch = fetch; }
          return fetch(...args);
        };
      }, { capture: true, once: true });
    }));
    await cardRow().click();
    const ms = Math.round(await left);
    expect(ms, `ms from the tap to the card's read leaving (${ms})`).toBeLessThan(240);
    // And the page is complete once the read is in, during or just after the growth.
    await expect(page.locator(".ow-content .ow-ph:visible")).toHaveCount(0);
  } finally { await page.unroute(/\/api\/merchant\/customers\/[^?/]+$/); }
});

test("in dark mode the card flies with the dark object shadow, from the root its layers hang off", async () => {
  await page.emulateMedia({ colorScheme: "dark" });
  try {
    await toList();
    const shadows = await page.evaluate(() => [getComputedStyle(document.documentElement).getPropertyValue("--shadow-object").trim(), getComputedStyle(document.querySelector(".ow-content")!).getPropertyValue("--shadow-object").trim()]);
    expect(shadows[0], "the root has the shadow the themed page has").toBe(shadows[1]);
  } finally { await page.emulateMedia({ colorScheme: "light" }); }
});
