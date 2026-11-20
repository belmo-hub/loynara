import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PLACEHOLDER } from "./support/placeholders";

// Motion in the owner area (DESIGN.md, Motion): a screen that is navigated to arrives once; a cold load, data in a
// placeholder's place and a return (Back, a filter, a period) do not; a tap after a screen change lands from --dur-press
// on; a segmented control's pill slides after a pointer pick only; a keyboard action shows its change at once; reduced
// motion has none of it and no loop.
const access = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string; ownerPassword: string };

// One sign-in for the file: the login limit counts every attempt.
test.describe.configure({ mode: "serial" });
let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // Every animation that starts is noted from the document's first frame on.
  await page.addInitScript(() => {
    const started: string[] = [];
    (window as unknown as { started: string[] }).started = started;
    document.addEventListener("animationstart", event => started.push(event.animationName), true);
    // Every frame: each swap's opacity as shown, its own times every one above it up to the content (a swap inside one
    // still fading multiplies with it), from the frame it is marked in. The first 40 frames of each.
    type Series = { inner: boolean; from: number; values: number[]; done?: boolean; name: string };
    const series = new Map<Element, Series>();
    (window as unknown as { swaps: () => Series[] }).swaps = () => [...series.values()];
    const shownOf = (node: Element) => {
      let shown = 1;
      for (let up: Element | null = node; up && !up.matches(".ow-content"); up = up.parentElement) shown *= Number(getComputedStyle(up).opacity);
      return shown;
    };
    const note = (node: Element) => {
      let entry = series.get(node);
      if (!entry) series.set(node, entry = { inner: !node.matches(".ow-screen"), from: Number(getComputedStyle(node).getPropertyValue("--swap-from")) || 0.4, values: [], name: `${node.tagName.toLowerCase()}.${String(node.className).slice(0, 50)} in ${node.parentElement?.closest("[data-swap]")?.className.slice(0, 40) ?? "-"} @${location.pathname}${location.search.slice(0, 20)}` });
      if (entry.done || entry.values.length >= 40) return;
      // Hidden (a card opened over the list while it still faded in): no longer on screen, nothing more to sample.
      if (!node.checkVisibility()) { entry.done = true; return; }
      entry.values.push(shownOf(node));
      // Its own fade over: what happens to it later (a swap above it) is that swap's.
      if (entry.values.length > 1 && !node.getAnimations().some(animation => (animation as CSSAnimation).animationName === "ow-swap" && animation.playState === "running")) entry.done = true;
    };
    // The frame a swap is marked in is the first it is painted in: its value is taken then, before the frame.
    addEventListener("DOMContentLoaded", () => new MutationObserver(records => { for (const record of records) if (record.target instanceof Element && record.target.matches(".ow-content [data-swap]") && !series.has(record.target)) note(record.target); }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-swap"] }));
    const look = () => {
      for (const node of document.querySelectorAll(".ow-content [data-swap]")) note(node);
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(access.ownerEmail);
  await page.getByLabel("Passwort").fill(access.ownerPassword);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL("/merchant");
});
test.afterAll(() => page.close());
test.beforeEach(() => page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "none" }));

/** Swaps that do not start at .4 as shown (0.35 to 0.45) or that step by more than 0.3 between two frames. */
const swapFaults = () => page.evaluate(() => (window as unknown as { swaps: () => { values: number[]; name: string }[] }).swaps().filter(({ values }) => values.length && (values[0]! < 0.35 || values[0]! > 0.45 || values.some((value, i) => i > 0 && Math.abs(value - values[i - 1]!) > 0.3))).map(({ values, name }) => `${name}: ${values.map(value => value.toFixed(2)).join(" ")}`));
const started = (...names: string[]) => page.evaluate(wanted => (window as unknown as { started: string[] }).started.filter(item => wanted.includes(item)).length, names);
/** The most entrances (Arrive, List arrive) seen running in any frame of the next `ms`. A finished one does not count. */
const entrances = (ms = 400) => page.evaluate(time => new Promise<number>(done => {
  let most = 0;
  const end = performance.now() + time;
  const look = () => {
    most = Math.max(most, document.getAnimations().filter(animation => /^ow-(arrive|rise|row)$/.test((animation as CSSAnimation).animationName ?? "") && animation.playState === "running").length);
    if (performance.now() < end) requestAnimationFrame(look); else done(most);
  };
  look();
}), ms);
const tab = (name: string) => page.getByRole("navigation", { name: "Bereiche" }).getByRole("link", { name, exact: true });
const team = () => page.locator('.ow-content a.ow-prog-row[href="/merchant/staff"]');
const changeStarted = () => page.waitForFunction(() => document.getAnimations().some(animation => (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition-old(")));

test("the milestone card stays once it is shown", async () => {
  // Right after sign-in: this browser has not shown the shop's milestone yet.
  // Since ENG-260 the milestone is a row of „Als Nächstes“.
  const card = page.getByRole("region", { name: "Als Nächstes" }).getByText(/^Deine \d+\. Karte$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  test.skip(!(await card.isVisible().catch(() => false)), "this shop has no milestone to show");
  await page.waitForTimeout(1500); // the reads have answered and the page has drawn again
  await expect(card).toBeVisible();
});

// Twice: with motion, and under reduced motion, where taking the slot away once left the page 16 px off for a frame.
for (const reducedMotion of ["no-preference", "reduce"] as const) test(`a cold load of the Übersicht keeps the band's place, never pushes the numbers down and writes the greeting once (motion: ${reducedMotion})`, async () => {
  await page.emulateMedia({ reducedMotion, forcedColors: "none" });
  // The reads the greeting and the band wait for answer last: before, „Guten Abend.“ was rewritten with the name and
  // the band landed after the board and pushed it down the screen. Now the band's place is held by a placeholder from
  // the first paint; a band takes it without moving anything, and without a band the slot closes in place, once.
  const late = /\/api\/(auth\/get-session|merchant\/readiness)/;
  await page.route(late, async route => { await new Promise(done => setTimeout(done, 400)); await route.continue(); });
  await page.goto("/merchant");
  type Frame = { hello: string | null; top: number | null; slot: boolean; band: boolean; slotHeight: number; bandHeight: number; diary: boolean; rows: boolean };
  const seen = await page.evaluate(() => new Promise<Frame[]>(done => {
    const frames: Frame[] = [];
    const end = performance.now() + 2500;
    const look = () => {
      const board = document.querySelector('.ow-content [data-ow="board"]');
      const slot = document.querySelector(".ow-content .ow-next-ph"), band = document.querySelector('.ow-content [data-ow="next"]');
      frames.push({
        hello: document.querySelector<HTMLElement>(".ow-content h1")?.innerText ?? null, top: board?.getBoundingClientRect().top ?? null,
        slot: slot !== null, band: band !== null, slotHeight: slot?.getBoundingClientRect().height ?? 0, bandHeight: band?.getBoundingClientRect().height ?? 0,
        diary: document.querySelector('.ow-content [data-ow="diary"]') !== null, rows: document.querySelector('.ow-content [data-ow="diary"] [data-day]') !== null,
      });
      if (performance.now() < end) requestAnimationFrame(look); else done(frames);
    };
    look();
  }));
  await page.unroute(late);
  const withBoard = seen.filter(frame => frame.top !== null);
  expect(withBoard.length, "the board showed").toBeGreaterThan(0);
  expect(new Set(seen.map(frame => frame.hello).filter(Boolean)).size, "the greeting is written once").toBe(1);
  expect(withBoard[0].slot || withBoard[0].band, "the band's place is held from the board's first frame").toBe(true);
  const tops = withBoard.map(frame => frame.top!);
  if (seen.some(frame => frame.band)) {
    // A band takes the slot's place. The slot is sized for a band of usual shape (a title and an action line); a band
    // with an extra text line is taller, and the board may move by that difference alone, never by the band's height.
    const slotHeight = Math.max(...seen.map(frame => frame.slotHeight)), bandHeight = [...seen].reverse().find(frame => frame.band)!.bandHeight;
    expect(slotHeight, "the slot held the band's place before the band came").toBeGreaterThan(0);
    expect(Math.abs((tops.at(-1)! - tops[0]) - (bandHeight - slotHeight)), `the board moved by the difference between the band (${bandHeight}) and its slot (${slotHeight}): ${tops[0]} to ${tops.at(-1)}`).toBeLessThanOrEqual(1);
    expect(Math.max(...tops) - tops[0], "the board is never pushed down by more than that difference").toBeLessThanOrEqual(Math.max(0, bandHeight - slotHeight) + 1);
  } else {
    // Without a band the board is never pushed down: it rises once, by the closing slot, and then stays.
    expect(tops.every((top, index) => index === 0 || top <= tops[index - 1] + 0.5), "the board is never pushed down").toBe(true);
    expect(Math.round(tops.at(-1)!), "the closed slot leaves no jump behind").toBe(Math.round(tops.filter((_, index) => !withBoard[index].slot)[0] ?? tops.at(-1)!));
  }
  expect(seen.every(frame => !frame.diary || frame.rows), "the diary comes with its data, never as a heading over a wait line").toBe(true);
});

test("a cold load does not arrive; a screen that is navigated to arrives once", async () => {
  await page.goto("/merchant/program");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForTimeout(800);
  // What replaces the shell's placeholder fades in (Skeleton to content); nothing rises or staggers.
  expect(await started("ow-arrive", "ow-rise", "ow-row"), "nothing rises or staggers on a cold load").toBe(0);
  expect(await started("ow-swap"), "what replaces the placeholders fades in").toBeGreaterThan(0);
  expect(await swapFaults(), "every swap shows at .4 first and climbs without a jump").toEqual([]);

  await tab("Mehr").click();
  await expect(team()).toBeVisible();
  await page.waitForTimeout(600);
  const arrived = await started("ow-arrive", "ow-rise", "ow-row");
  expect(await started("ow-arrive", "ow-rise"), "the blocks arrived").toBeGreaterThan(0);
  // Rows inside an arriving block do not List-arrive: a second motion on top of the block's left a near-blank frame (Design, 10 Nov).
  expect(await started("ow-row"), "the rows come with their block").toBe(0);
  // What a refresh of the page's data looks like to the page: the same nodes, drawn again.
  await page.evaluate(() => { window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("resize")); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(600);
  expect(await started("ow-arrive", "ow-rise", "ow-row"), "nothing arrives a second time").toBe(arrived);
  expect(await page.evaluate(() => [...document.querySelectorAll(".ow-content *")].filter(node => getComputedStyle(node).transform !== "none" && !node.closest("svg")).length), "no transform is left behind").toBe(0);

  // Back in the history is a return to a screen shown before: it does not arrive again.
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Programm", level: 1 })).toBeVisible();
  await page.waitForTimeout(600);
  expect(await started("ow-arrive", "ow-rise", "ow-row"), "nothing arrives on the way back").toBe(arrived);
});

test("a page's own back link is a return: the screen it leads to does not arrive", async () => {
  await page.goto("/merchant/more");
  const shop = page.locator('.ow-content a.ow-prog-row[href="/merchant/settings"]');
  await expect(shop).toBeVisible();
  await shop.click();
  await expect(page).toHaveURL(/\/merchant\/settings$/);
  await page.waitForTimeout(600);
  const opened = await started("ow-arrive", "ow-rise", "ow-row");
  expect(opened, "the screen a row opens arrives").toBeGreaterThan(0);
  await page.locator(".ow-content a.ow-back").click();
  await expect(team()).toBeVisible();
  await page.waitForTimeout(600);
  expect(await started("ow-arrive", "ow-rise", "ow-row"), "the screen its back link leads to does not, and its rows do not stagger").toBe(opened);
});

test("a content tap after a tab tap is dropped before 120 ms and lands from 120 ms on", async () => {
  // The row's place, read before the change: during it every round trip pushes the tap later.
  await page.goto("/merchant/more");
  const box = (await team().boundingBox())!;
  // In ms, read the way the shell reads it: the built CSS may write the token as ".12s".
  const token = () => page.evaluate(() => {
    const value = getComputedStyle(document.documentElement).getPropertyValue("--dur-press").trim();
    return Math.round(parseFloat(value) * (value.endsWith("ms") ? 1 : 1000));
  });
  expect(await token(), "the drop window is --dur-press").toBe(120);
  // A runner's round trips alone take a tap about 130 ms into the change, so the window and the fade are stretched for
  // this test: the shell reads its window from --dur-press. Same code path, same rule.
  const [press, ui] = [400, 1200];
  for (const [wait, lands] of [[0, false], [press + 100, true]] as const) {
    await page.goto("/merchant/program");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.addStyleTag({ content: `html:root { --dur-press: ${press}ms; --dur-ui: ${ui}ms; }` });
    expect(await token()).toBe(press);
    await page.waitForTimeout(500);
    // How far into the change the tap came, by the shell's own clock.
    await page.evaluate(() => window.addEventListener("pointerdown", () => {
      const starts = document.getAnimations().filter(animation => (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition")).map(animation => Number(animation.startTime ?? Infinity));
      (window as unknown as { tapSince: number }).tapSince = performance.now() - Math.min(...starts);
    }, true));
    await tab("Mehr").click();
    await changeStarted();
    if (wait) await page.waitForTimeout(wait);
    // A raw tap at the row's place: the new screen is captured for the change and takes no hit tests while it runs.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const since = Math.round(await page.evaluate(() => (window as unknown as { tapSince: number }).tapSince));
    if (lands) {
      // The change lasts as long as the old screen's fade, --dur-press: a tap after it is an ordinary tap on the new screen.
      await expect(page, `a tap ${press + 100} ms after the change began lands on the row`).toHaveURL(/\/merchant\/staff$/);
    } else {
      expect(since, "the early tap came inside the window").toBeLessThan(press);
      await page.waitForTimeout(700);
      await expect(page, `a tap ${since} ms into the change is dropped`).toHaveURL(/\/merchant\/more$/);
      await expect(team(), "the change ended at the tap").toBeVisible();
    }
  }
});

test("data that takes a placeholder's place fades in without a rise, and a new period does not arrive", async () => {
  let release = () => {};
  const held = new Promise<void>(done => { release = done; });
  // The page's own read (the shell needs none of it), so the screen stands with its placeholders until it answers.
  await page.route(/\/api\/merchant\/analytics\?/, async route => { await held; await route.continue(); });
  await page.goto("/merchant/actions");
  await page.locator('.ow-content a[href="/merchant/analytics"]').click();
  const board = page.locator(".ow-content .ow-board");
  await expect(board).toHaveAttribute("aria-busy", "true");
  await page.waitForTimeout(600);
  expect(await started("ow-arrive", "ow-rise"), "the title arrived with the screen").toBeGreaterThan(0);
  expect(await board.evaluate(node => node.closest(".ow-page > *")?.hasAttribute("data-arrive")), "the block with the placeholder did not").toBe(false);
  const before = await started("ow-arrive", "ow-rise", "ow-row");
  const fadesBefore = await started("ow-swap");
  release();
  await expect(page.locator(".ow-content .ow-board-big")).toBeVisible();
  expect(await page.locator(".ow-content [data-swap]").count(), "what replaced a placeholder is marked").toBeGreaterThan(0);
  await page.waitForTimeout(400);
  expect(await started("ow-swap"), "it fades in instead of cutting").toBeGreaterThan(fadesBefore);
  expect(await started("ow-arrive", "ow-rise", "ow-row"), "no rise and no stagger").toBe(before);
  await page.unroute(/\/api\/merchant\/analytics\?/);

  await page.getByRole("group", { name: "Zeitraum" }).getByRole("button", { name: "90 Tage" }).click();
  expect(await entrances(), "the 90 days do not arrive").toBe(0);
  await expect(page.locator(".ow-content .ow-board-sub")).toContainText("90 Tage");
  expect(await started("ow-arrive", "ow-rise", "ow-row")).toBe(before);
});

// Design, #314: the Übersicht's board and next-step frame and the card's page hold their placeholders inside blocks of
// their own; what replaces them fades in too, and only once (the outermost swap).
for (const [where, url, read] of [["Übersicht", "/merchant", /\/api\/merchant\/(analytics\/location|retention|readiness)/], ["Kartenseite", "", /\/api\/merchant\/customers\/[^?/]+$/]] as const) test(`the ${where} fades its content in from its placeholders`, async () => {
  let release = () => {};
  const held = new Promise<void>(done => { release = done; });
  const hold = () => page.route(read, async route => { await held; await route.continue(); });
  if (url) { await hold(); await page.goto(url); }
  else {
    await page.goto("/merchant/customers?activity=all");
    const row = page.locator('section[aria-labelledby="cu-h"] a.ow-prog-row').first();
    await expect(row).toBeVisible();
    await hold();
    await row.click();
  }
  await expect(page.locator(".ow-content .ow-ph").first()).toBeVisible();
  await page.waitForTimeout(300);
  const swaps = await started("ow-swap");
  release();
  await expect(page.locator(".ow-content .ow-ph")).toHaveCount(0);
  await page.waitForTimeout(400);
  expect(await page.locator(".ow-content [data-swap]").count(), "what replaced a placeholder is marked").toBeGreaterThan(0);
  expect(await started("ow-swap"), "it fades in instead of cutting").toBeGreaterThan(swaps);
  expect(await swapFaults(), "every swap shows at .4 first and climbs without a jump").toEqual([]);
  await page.unroute(read);
});

test("Back from a card and a filter chip are returns: nothing arrives again", async () => {
  await page.goto("/merchant/customers"); // opens on „Alle Karten“ since the mix (ENG-257)
  await expect(page.getByRole("heading", { name: "Alle Karten" })).toBeVisible();
  const first = page.locator('section[aria-labelledby="cu-h"] a.ow-prog-row').first();
  await expect(first).toBeVisible();
  await page.getByRole("group", { name: "Kartenstatus" }).getByRole("button", { name: "Aktiv" }).click();
  expect(await entrances(), "the filtered list does not arrive").toBe(0);
  await expect(first).toBeVisible();

  await first.click();
  const reissue = page.getByRole("button", { name: /Karte neu ausstellen/ });
  await expect(reissue).toBeVisible();
  await page.locator(".ow-content a.ow-back:visible").click();
  expect(await entrances(), "the list is shown again without arriving").toBe(0);
  await expect(page.getByRole("heading", { name: "Alle Karten" })).toBeVisible();
});

test("forced colours: the checkbox is the native control again", async () => {
  // Goes on from the list the test before ends on: the list's reads are rate-limited, so it is not loaded a second time.
  await page.locator('section[aria-labelledby="cu-h"] a.ow-prog-row').first().click();
  await page.getByRole("button", { name: /Karte neu ausstellen/ }).click();
  const box = page.getByRole("checkbox", { name: "Berechtigung geprüft" });
  await expect(box).toBeVisible();
  expect(await box.evaluate(node => getComputedStyle(node).appearance), "the house box where colours are free").toBe("none");
  await page.emulateMedia({ forcedColors: "active" });
  expect(await box.evaluate(node => getComputedStyle(node).appearance), "the native box under forced colours").toBe("auto");
  // A transparent border is drawn under forced colours: only the current sub-tab may keep its line.
  const line = (current: boolean) => page.locator(`.ow-subnav a${current ? '[aria-current="page"]' : ':not([aria-current="page"])'}`).first().evaluate(node => getComputedStyle(node).borderBottomColor);
  const canvas = await page.locator(".ow-subnav").evaluate(node => { const probe = document.createElement("i"); probe.style.color = "Canvas"; node.append(probe); const colour = getComputedStyle(probe).color; probe.remove(); return colour; });
  // The line's colour changes over --dur-press, so the switch to forced colours is given that time.
  await expect.poll(() => line(false), { message: "the other sub-tab's line is the canvas" }).toBe(canvas);
  expect(await line(true), "the current sub-tab's line shows").not.toBe(canvas);
});

test("a segmented control's pill slides after a pointer pick and not after keyboard picks", async () => {
  await page.goto("/merchant/analytics");
  const segment = (days: number) => page.getByRole("group", { name: "Zeitraum" }).getByRole("button", { name: `${days} Tage` });
  await expect(segment(90)).toBeVisible();
  await segment(90).click();
  await expect(segment(90)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => started("ow-slide"), { message: "the pill slid" }).toBe(1);
  // Pointer, key, key: neither keyboard pick slides, the second one not from the pointer pick's stale place either.
  for (const days of [30, 90]) {
    await segment(days).focus();
    await page.keyboard.press("Enter");
    await expect(segment(days)).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(300);
    expect(await started("ow-slide"), `the keyboard pick of ${days} Tage changes at once`).toBe(1);
  }
});

test("a keyboard toggle shows its state at once; a pointer toggle slides", async () => {
  await page.goto("/merchant/program/winback");
  const toggle = page.locator('.ow-content input[role="switch"]').first();
  await expect(toggle).toBeVisible();
  const sliding = () => toggle.evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === "running").length);
  await toggle.focus();
  await page.keyboard.press("Space");
  expect(await sliding(), "the key press moved the thumb at once").toBe(0);
  await toggle.click();
  expect(await sliding(), "the pointer press lets it slide").toBeGreaterThan(0);
});

test("reduced motion: nothing arrives, slides, grows or loops", async () => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/merchant/program");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await tab("Mehr").click();
  await expect(team()).toBeVisible();
  await tab("Aktionen").click();
  await page.locator('.ow-content a[href="/merchant/analytics"]').click();
  await page.getByRole("group", { name: "Zeitraum" }).getByRole("button", { name: "90 Tage" }).click();
  await page.waitForTimeout(600);
  for (const name of ["ow-arrive", "ow-rise", "ow-row", "ow-fade", "ow-slide", "ow-grow", "ow-drop", "ow-shimmer", "ow-pulse"]) expect(await started(name), name).toBe(0);
});

// Design, #314 re-checks: on a cold load the screen fades in from its loading frame and the list, split or greeting
// inside it follows from its own placeholder, at any point of the screen's fade. The inner fade starts where the
// content shows at .4 in all (owner-shell's --swap-from), so neither layer snaps and nothing cuts in.
test("a cold load: content that replaces an inner placeholder shows at .4 first, whatever the screen has reached", async () => {
  const loads = [["/merchant/customers", /\/api\/merchant\/customers\?/], ["/merchant/program", /\/api\/program\//], ["/merchant", /\/api\/(merchant\/(analytics\/location|retention|readiness)|auth\/get-session)/]] as const;
  let caughtEarly = false;
  // The inner reads are answered from what a first load read, after exactly `delay`: a slow runner's server would
  // otherwise always answer after the screen's fade is near its end, and the early case would never be tested.
  const answers = new Map<string, { status: number; headers: Record<string, string>; body: Buffer }>();
  for (const [url, read] of loads) for (const delay of [-1, 0, 30, 45, 120]) {
    await page.route(read, async route => {
      const key = route.request().url();
      if (!answers.has(key)) { const response = await route.fetch(); answers.set(key, { status: response.status(), headers: response.headers(), body: await response.body() }); }
      if (delay > 0) await new Promise(done => setTimeout(done, delay));
      await route.fulfill(answers.get(key)!);
    });
    try {
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator(`.ow-content :is(${PLACEHOLDER})`)).toHaveCount(0);
      await page.waitForTimeout(500);
      if (delay < 0) continue; // the first load only fills the answers
      const swaps = await page.evaluate(() => (window as unknown as { swaps: () => { inner: boolean; from: number }[] }).swaps());
      expect(swaps.filter(swap => swap.inner).length, `${url} at ${delay} ms: content inside the screen took a placeholder's place`).toBeGreaterThan(0);
      // An inner swap that starts above .444 arrived while the screen was still below 0.9.
      caughtEarly ||= swaps.some(swap => swap.inner && swap.from > 0.4 / 0.9 + 1e-3);
      expect(await swapFaults(), `${url} at ${delay} ms: swaps that do not show at .4 first or that jump`).toEqual([]);
    } finally { await page.unroute(read); }
  }
  expect(caughtEarly, "at least one inner swap arrived while the screen's fade was below 0.9").toBe(true);
});
