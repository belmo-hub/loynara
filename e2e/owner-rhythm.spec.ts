import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, request as apiRequest, test, type Page } from "@playwright/test";
import { smallTargets } from "./support/targets";
import { signUp } from "./support/sign-up";

// The owner area's one rhythm (Design, 12 Nov, rulings SP1 to SP5 and SP9), measured on the rendered pages:
// 24 from the page head to the first block; 20 above a section label and 8 below it, with or without its „?“;
// every card and panel 16 inside; a chip 4 under its title; a hint 8 under its block.
const access = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string; ownerPassword: string; programSlug: string };

test.describe.configure({ mode: "serial" });
let page: Page;
/** The card booked below: Übersicht's diary and this card's „Kartenverlauf“ have entries to measure. */
let cardId = "";
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(access.ownerEmail);
  await page.getByLabel("Passwort").fill(access.ownerPassword);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL("/merchant");
  // The seed's own bookings do not count outside the demo environment, so the diary and a card's history would be
  // empty. One synthetic card gets two stamps the way the Kasse books them.
  const origin = new URL(page.url()).origin, headers = { Origin: origin };
  const guest = await apiRequest.newContext({ baseURL: origin, extraHTTPHeaders: headers });
  const joined = await (await guest.post("/api/enroll", { data: { slug: access.programSlug, acceptedTerms: true, marketingOptIn: false } })).json() as { cardToken?: string };
  expect(joined.cardToken, "a synthetic card was created").toBeTruthy();
  const card = await (await guest.get(`/api/card/${joined.cardToken}`)).json() as { scanCode: string };
  await guest.dispose();
  const found = await (await page.request.get(`/api/cashier/lookup?code=${encodeURIComponent(card.scanCode)}`)).json() as { membershipId: string };
  cardId = found.membershipId;
  for (let stamp = 0; stamp < 2; stamp++) {
    const booked = await page.request.post("/api/cashier/award", { headers, data: { membershipId: cardId, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() } });
    expect(booked.ok(), `stamp ${stamp + 1} booked at the Kasse`).toBe(true);
  }
});
test.afterAll(() => page.close());

const rhythm = () => page.evaluate(() => {
  const box = (el: Element) => el.getBoundingClientRect(), px = (n: number) => Math.round(n * 2) / 2, main = document.getElementById("ow-main")!;
  const before = (el: Element | null) => { let p = el?.previousElementSibling ?? null; while (p && box(p).height === 0) p = p.previousElementSibling; return p; };
  const head = main.querySelector(".ow-page > .ow-pagehead");
  const labels = [...main.querySelectorAll(".ow-rows-head, .ow-section-head, .ow-prog h2, .ow-diary > h2, .ow-group > legend:not(.ow-sr)")].filter(el => !el.closest("dialog") && !(el.matches("h2") && el.closest(".ow-rows-head")));
  return {
    head: head?.nextElementSibling ? px(box(head.nextElementSibling).top - box(head).bottom) : null,
    // A legend's space above is its group's hairline (16, line, 16), not a label gap.
    above: labels.filter(el => !el.matches("legend")).flatMap(el => { const block = el.closest(".ow-rows-section, .ow-diary, .ow-prog > div") ?? el, prev = before(block) ?? before(block.parentElement); return prev ? [px(box(block).top - box(prev).bottom)] : []; }),
    below: labels.flatMap(el => el.nextElementSibling ? [px(box(el.nextElementSibling).top - box(el).bottom)] : []),
    helpGrowsRow: [...main.querySelectorAll(".ow-rows-head")].map(el => px(box(el).height - box(el.querySelector("h2")!).height)),
    padding: [...new Set([...main.querySelectorAll(".ow-card, .ow-board, .ow-qpanel")].map(el => getComputedStyle(el).padding))],
    chips: [...main.querySelectorAll(".ow-prog-text .ow-chip")].flatMap(el => el.previousElementSibling ? [px(box(el).top - box(el.previousElementSibling).bottom)] : []),
    // The „?“ beside a label is a 44 px target that stops where the first row's target begins.
    helpIntoRow: [...main.querySelectorAll(".ow-rows-head > button")].flatMap(el => { const row = el.parentElement!.nextElementSibling; return row ? [px(Math.max(0, box(el).bottom - box(row).top))] : []; }),
    diaries: main.querySelectorAll('.ow-diary > h2, [data-ow="diary"] :is(h2, h3)').length,
    hints: [...main.querySelectorAll(".ow-page > .ow-hint, .ow-q > .ow-hint, .ow-group > .ow-hint")].flatMap(el => { const prev = before(el); return prev ? [px(box(el).top - box(prev).bottom)] : []; }),
  };
});
const only = (values: Array<number | string>, ...allowed: Array<number | string>) => values.filter(value => !allowed.includes(value));

// Screens whose content has no section label of the kinds above; the rest must show at least one before they pass.
const NO_LABELS = ["/merchant/adviser", "/merchant/staff/invite", "/merchant/customers/import"];
// Programm (ENG-259) and Kunden (ENG-257) have the mix rhythm, measured in their own tests below.
for (const path of ["/merchant", "/merchant/analytics", "/merchant/program/card", "/merchant/billing", "/merchant/locations", "/merchant/customers/import", "/merchant/settings", "/merchant/staff/invite", "/merchant/referrals", "/merchant/adviser"]) {
  test(`${path} keeps the owner rhythm`, async () => {
    await page.goto(path);
    await expect(page.locator("#ow-main h1")).toBeVisible();
    await expect.poll(async () => {
      const m = await rhythm();
      // `loaded`: the page's own content is there (labels, or the adviser's panels), so an empty list is not a pass.
      // Übersicht must show its diary (the last days, or the first steps). Since ENG-260 it is drawn in the mix, whose
      // rhythm (32 above a section, 12 to its panel) is measured against the approved pictures, not these house labels.
      return { loaded: (m.below.length > 0 || NO_LABELS.includes(path) || path === "/merchant") && (path !== "/merchant" || m.diaries > 0), head: m.head, above: only(m.above, 20, 24), below: only(m.below, 8), helpGrowsRow: only(m.helpGrowsRow, 0), helpIntoRow: only(m.helpIntoRow, 0), padding: only(m.padding, "16px"), chips: only(m.chips, 4), hints: only(m.hints, 8) };
    }).toEqual({ loaded: true, head: path === "/merchant" ? null : 24, above: [], below: [], helpGrowsRow: [], helpIntoRow: [], padding: [], chips: [], hints: [] }); // Übersicht greets instead of a page head
    expect(await smallTargets(page, { scope: ".ow-rows-head" })).toEqual([]);
  });
}

// Kunden is drawn in the founder's mix (ENG-257, mock mix/kunden.html), not the house rhythm above: 24 from the title to
// the search, 16 between blocks, 32 above a section title, 12 from a title to its panel and from a panel to its note.
test("/merchant/customers keeps the mix rhythm", async () => {
  await page.goto("/merchant/customers");
  await expect(page.locator('section[aria-labelledby="cu-h"] a.ow-prog-row').first()).toBeVisible();
  // Polled: the picker comes with the groups' read, which can land after the cards.
  await expect.poll(() => page.evaluate(() => {
    const box = (q: string) => document.querySelector(`#ow-main ${q}`)?.getBoundingClientRect(), gap = (a: string, b: string) => { const [x, y] = [box(a), box(b)]; return x && y ? Math.round(y.top - x.bottom) : null; };
    return { search: gap("h1", "form[role=search]"), picker: gap("form[role=search]", "label:has(> select)"), invite: gap('section[aria-labelledby="cu-h"] ul', "[class*=invite] h2"),
      panel: gap("[class*=invite] h2", "[class*=invite] ul"), note: gap("[class*=invite] ul", "[class*=invite] > .ow-prog-note") };
  })).toEqual({ search: 24, picker: 16, invite: 32, panel: 12, note: 12 });
});

// Programm in the mix (ENG-259): every section title 12 above its panel, sections 32 apart in each column.
test("/merchant/program keeps the mix rhythm", async () => {
  await page.goto("/merchant/program");
  await expect(page.getByRole("heading", { level: 2, name: "Für die Ergebnisse" })).toBeVisible();
  expect(await page.evaluate(() => {
    const box = (el: Element) => el.getBoundingClientRect(), px = (n: number) => Math.round(n * 2) / 2;
    const titles = [...document.querySelectorAll("#ow-main section > h2, #ow-main section > div > h2")];
    const below = titles.map(h => { const head = h.parentElement!.matches("section") ? h : h.parentElement!; return px(box(head.nextElementSibling!).top - box(head).bottom); });
    const sections = [...document.querySelectorAll("#ow-main section:has(> h2, > div > h2)")];
    const above = sections.flatMap(sec => { const prev = sections.filter(o => o !== sec && Math.abs(box(o).left - box(sec).left) < 1 && box(o).bottom <= box(sec).top).sort((a, b) => box(a).bottom - box(b).bottom).at(-1); return prev ? [px(box(sec).top - box(prev).bottom)] : []; });
    return { titles: titles.length, below: [...new Set(below)], above: [...new Set(above)] };
  })).toEqual({ titles: 6, below: [12], above: [32] });
});

// The card screen in the mix (ENG-258): the card 16 above „Verlauf“ on the phone column, every statement line at least
// 64 high and on the 4 px grid (the two stamps booked in the setup).
test("a card's „Verlauf“ keeps the mix rhythm", async () => {
  await page.goto(`/merchant/customers?activity=all&card=${cardId}`);
  await expect(page.getByRole("heading", { name: "Verlauf", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const rows = [...document.querySelectorAll("#ow-main [data-entry]")].map(row => row.getBoundingClientRect().height);
    return { entries: rows.length >= 2, off: rows.filter(height => height < 64 || Math.round(height) % 4 !== 0) };
  })).toEqual({ entries: true, off: [] });
});

// The card's figures on the phone (ENG-290, Design 19 Nov): label left, figure right, one row each, and the longest
// house date („27. Sept. 2026“) never breaks, with no sideways scroll; all three figures share one size, 22 under 360
// and at 600–699, 28 elsewhere (Design 20 Nov).
test("a card's figures stay on one line, on their label's row, on the phone", async () => {
  for (const width of [320, 359, 360, 390, 430, 600, 608, 650, 699, 700]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/merchant/customers?activity=all&card=${cardId}`);
    const since = page.locator("#ow-main").getByText("Karte seit", { exact: true });
    await expect(since).toBeVisible();
    const facts = await since.locator("xpath=../..").evaluate(panel => {
      [...panel.querySelectorAll("b")].at(-1)!.textContent = "27. Sept. 2026";
      return {
        scroll: document.documentElement.scrollWidth - innerWidth,
        sizes: [...new Set([...panel.querySelectorAll("b")].map(b => getComputedStyle(b).fontSize))],
        firstLine: getComputedStyle(panel.children[0]).borderTopWidth,
        rows: [...panel.children].map(row => {
          const figure = row.querySelector("b")!, label = row.querySelector("span")!, f = figure.getBoundingClientRect(), l = label.getBoundingClientRect();
          return { lines: figure.getClientRects().length, tall: f.height > parseFloat(getComputedStyle(figure).lineHeight) + .5,
            labelFirst: l.right <= f.left, sameRow: Math.abs((f.top + f.bottom) / 2 - (l.top + l.bottom) / 2) < 1 };
        }),
      };
    });
    const size = width < 360 || (width >= 600 && width < 700) ? "22px" : "28px";
    expect(facts, `at ${width}`).toEqual({ scroll: 0, sizes: [size], firstLine: "0px", rows: Array(3).fill({ lines: 1, tall: false, labelFirst: true, sameRow: true }) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
});

// A card that is not there (ENG-258 states): the notice alone, no retry that could not find it, no title placeholder.
test("a missing card says so without a retry or a title placeholder", async () => {
  await page.goto("/merchant/customers?activity=all&card=00000000-0000-4000-8000-000000000000");
  await expect(page.getByText("Diese Karte haben wir nicht gefunden.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Erneut laden" })).toHaveCount(0);
  await expect(page.locator("#ow-main .ow-pagehead :is(h1, [class*=titleBar]):visible")).toHaveCount(0); // the list waits hidden under the card
});

// Heights (Design, 12 Nov, ruling SP6 and call 6): owner fields, selects and the button that ends a form are 52;
// the Kasse's field is 56.
const heights = (selector: string) => page.locator(selector).evaluateAll(list => [...new Set(list.filter(el => el.getBoundingClientRect().height > 0).map(el => Math.round(el.getBoundingClientRect().height)))]);

for (const [path, controls] of [
  ["/merchant/locations/new", "main :is(input.ow-input, select.ow-select, button[type=submit])"],
  ["/merchant/customers/import", "main :is(input.ow-input, button[type=submit])"],
  ["/merchant/program/card", "main :is(input.ow-input, .ow-colorrow input[type=color], .ow-savebar button)"],
  ["/merchant/program/gibt-es-nicht", "main section a[class*=button]"],
] as const) {
  test(`${path}: fields and the closing button are 52 high`, async () => {
    await page.goto(path);
    await expect(page.locator(controls).first()).toBeVisible();
    expect(await heights(controls)).toEqual([52]);
  });
}

test("the Kundenkarte's idle save bar stands 16 under the card, with no line against it", async () => {
  await page.goto("/merchant/program/card");
  await expect(page.locator(".ow-savebar[data-idle]")).toBeVisible();
  expect(await page.evaluate(() => {
    const bar = document.querySelector(".ow-savebar")!, state = bar.querySelector(".ow-savestate")!, card = bar.previousElementSibling!;
    return { gap: Math.round(state.getBoundingClientRect().top - card.getBoundingClientRect().bottom), line: getComputedStyle(bar).borderTopWidth };
  })).toEqual({ gap: 16, line: "0px" });
});

test("the Kasse's code field is 56 high, like its buttons", async () => {
  await page.goto("/cashier");
  await expect(page.locator("#cashier-code")).toBeVisible();
  expect(await heights("#cashier-code, main form button[type=submit]")).toEqual([56]);
});

// Overlays (ruling SP10 and call 8): the title 8 under a phone sheet's handle and 12 above the text, the footer's line
// 12 under the content and 12 above its 48 px button; a dialog 20 inside, 12 under its title, 24 above its buttons.
test("a help sheet and the unsaved-changes dialog keep the overlay rhythm", async () => {
  await page.goto("/merchant/analytics");
  await page.locator(".ow-tile-q").first().click();
  const sheet = page.locator("dialog[open]");
  await expect(sheet.getByRole("button", { name: "Schließen" }).last()).toBeVisible();
  await expect.poll(() => sheet.evaluate(el => {
    const box = (e: Element) => e.getBoundingClientRect(), half = (n: number) => Math.round(n * 2) / 2;
    const [handle, header, content, footer] = [...el.children], title = header.querySelector("h2")!, button = footer.querySelector("button")!;
    return { handle: half(box(title).top - box(handle).bottom), text: half(box(content.firstElementChild!).top - box(title).bottom), line: half(box(footer).top - box(content.lastElementChild!).bottom), button: half(box(button).top - box(footer).top - 1), height: box(button).height, radius: getComputedStyle(el).borderTopLeftRadius };
  })).toEqual({ handle: 8, text: 12, line: 12, button: 12, height: 48, radius: "28px" });

  await page.goto("/merchant/program/card");
  await page.getByLabel("Programmname").fill("Ein anderer Name");
  await page.locator(".ow-back").first().click();
  const dialog = page.locator(".ow-dialog");
  await expect(dialog).toBeVisible();
  // Polled: the dialog scales in over --dur-ui.
  await expect.poll(() => dialog.evaluate(el => {
    const box = (e: Element) => e.getBoundingClientRect(), half = (n: number) => Math.round(n * 2) / 2, [title, text, actions] = [...el.children];
    return [half(box(title).top - box(el).top), half(box(title).left - box(el).left), half(box(text).top - box(title).bottom), half(box(actions).top - box(text).bottom), ...[...actions.children].map(b => half(box(b).height)), getComputedStyle(el).borderTopLeftRadius];
  })).toEqual([20, 20, 12, 24, 48, 48, "28px"]);
  await page.getByRole("button", { name: "Änderungen verwerfen" }).click();
});

test("at 320 px the pinned save bar covers neither the card's end nor a field brought up to it", async () => {
  await page.setViewportSize({ width: 320, height: 568 });
  try {
    await page.goto("/merchant/program/card");
    await page.getByLabel("Programmname").fill("Ein anderer Name");
    await expect(page.locator(".ow-savebar:not([data-idle])")).toBeVisible();
    // Scrolled inside the poll: the page may still be growing when the bar appears.
    await expect.poll(() => page.evaluate(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
      return Math.round(document.querySelector(".ow-savebar")!.getBoundingClientRect().top - document.querySelector(".ow-studio")!.getBoundingClientRect().bottom);
    })).toBeGreaterThanOrEqual(0);
    // From the top, so the browser brings the half-hidden field up by its scroll margin. (A field wholly out of view
    // is centred by the browser instead; the margin does not govern that case.)
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    // It starts under the bar, so the check below cannot pass with nothing to do.
    expect(await page.evaluate(() => document.querySelector("#cs-name")!.getBoundingClientRect().bottom > document.querySelector(".ow-savebar")!.getBoundingClientRect().top)).toBe(true);
    await page.locator("#cs-name").focus();
    await expect.poll(() => page.evaluate(() => Math.round(document.querySelector(".ow-savebar")!.getBoundingClientRect().top - document.activeElement!.getBoundingClientRect().bottom))).toBeGreaterThanOrEqual(0);
    await page.getByRole("button", { name: "Verwerfen", exact: true }).click();
  } finally { await page.setViewportSize({ width: 390, height: 844 }); }
});

// ENG-245 (WCAG 2.4.11): from 1024 px the save bar is sticky at the window's end, and a field reached with Tab
// must stop above it, not under it. The bar is one row (78 px) with unsaved changes and wraps to two when a failed
// save adds its detail line, so the page takes the bar's real height.
test("on desktop no Tab stop lands under the sticky save bar, one row or wrapped", async () => {
  /** From the first field by real Tab to the bar: the stops, and those that end under the bar. */
  const walk = async () => {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.getByLabel("Geschäftsname").focus();
    const stops: string[] = [], covered: string[] = [];
    let scrolled = false;
    for (let press = 0; press < 40; press++) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const el = document.activeElement!, bar = document.querySelector(".ow-savebar")!, box = el.getBoundingClientRect(), top = bar.getBoundingClientRect().top;
        return { name: el.getAttribute("aria-label") || el.id || el.textContent?.trim().slice(0, 30) || el.tagName, inBar: bar.contains(el), inMain: Boolean(el.closest("main")), under: box.bottom > top + 1, scrollY: window.scrollY };
      });
      if (stop.inBar || !stop.inMain) break;
      stops.push(stop.name);
      if (stop.scrollY > 0) scrolled = true;
      if (stop.under) covered.push(stop.name);
    }
    expect(stops.length, "the form's controls were reached").toBeGreaterThan(5);
    expect(scrolled, "the page had to scroll to reach them").toBe(true);
    return covered;
  };
  const barHeight = () => page.locator(".ow-savebar").evaluate(el => Math.round(el.getBoundingClientRect().height));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route("**/api/merchant/program/brand", route => route.request().method() === "POST" ? route.fulfill({ status: 500, contentType: "application/json", body: "{}" }) : route.continue());
  try {
    await page.goto("/merchant/program/card");
    await page.addStyleTag({ content: "html { scroll-behavior: auto !important; }" });
    await page.getByLabel("Geschäftsname").fill("Ein anderer Name");
    await expect(page.locator(".ow-savebar:not([data-idle])")).toBeVisible();
    expect(await barHeight(), "one row").toBe(78);
    expect(await walk()).toEqual([]);

    // A save that fails adds the detail line, and the bar wraps.
    await page.getByRole("button", { name: "Kundenkarte speichern" }).click();
    await expect(page.locator('.ow-savestate[data-state="error"]')).toBeVisible();
    expect(await barHeight(), "wrapped").toBeGreaterThan(110);
    expect(await walk()).toEqual([]);
  } finally {
    await page.unroute("**/api/merchant/program/brand");
    await page.getByRole("button", { name: "Verwerfen", exact: true }).click().catch(() => {});
    await page.setViewportSize({ width: 390, height: 844 });
  }
});

// ENG-278 (Design, 19 Nov): on a new owner's setup screen the address notice keeps its button in one place from idle
// through busy to every outcome, and its title on its icon. The resend answers are stubbed: no mail is involved.
test("the address notice's button stays put through busy, sent, limited and failed", async ({ browser }) => {
  const owner = await browser.newPage();
  try {
    const email = `notice-${randomUUID()}@example.test`;
    expect((await signUp(owner.request, { data: { name: "Synthetic notice owner", email, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
    for (const width of [880, 1440]) {
      await owner.setViewportSize({ width, height: 900 });
      for (const [outcome, status] of [["sent", 200], ["limited", 429], ["failed", 503]] as const) {
        let release = () => {};
        const answered = new Promise<void>(resolve => { release = resolve; });
        await owner.unroute("**/api/auth/send-verification-email");
        await owner.route("**/api/auth/send-verification-email", async route => {
          await answered;
          await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(status === 200 ? { status: true } : { message: "stubbed" }) });
        });
        await owner.goto("/merchant/program");
        // The shell settles on the setup frame first; the notice is mounted there for good.
        const button = owner.locator(".ow-bare--setup .ow-verify button");
        await expect(button).toHaveText("E-Mail erneut senden");
        // Layout boxes, not painted ones: the house press feedback scales the pill for a moment.
        const place = () => owner.evaluate(() => {
          const at = (selector: string) => {
            let node = document.querySelector<HTMLElement>(selector), left = 0, top = 0;
            const width = node!.offsetWidth;
            for (; node; node = node.offsetParent as HTMLElement | null) { left += node.offsetLeft; top += node.offsetTop; }
            return { left, top, width };
          };
          const b = at(".ow-verify button"), title = at(".ow-verify strong"), icon = at(".ow-verify .ow-notice > span");
          return { left: b.left, top: b.top, width: b.width, title: title.top - icon.top };
        });
        const idle = await place();
        await button.click();
        await expect(button).toHaveText("Wird gesendet …");
        expect(await place(), `${width}: busy`).toEqual(idle);
        release();
        await expect(owner.locator(".ow-verify-status")).not.toBeEmpty();
        expect(await place(), `${width}: ${outcome}`).toEqual(idle);
        if (outcome === "sent") await expect(button).toHaveAttribute("aria-disabled", "true");
        if (outcome === "sent") await expect(button).toBeFocused();
      }
    }
  } finally { await owner.close(); }
});

// Finding 17 (Design, 22 Nov): „Weiter“ stays pressable for a text that isn't ready; the press focuses the field and shows
// its existing error. Capped, quiet hours and no reach keep it disabled (their notice explains). The overview is answered
// here, so the shop's real cap and reach don't matter.
test("„Weiter“ on a message that isn't ready shows why instead of doing nothing", async () => {
  const overview = { shopName: "Demo", reach: 5, remaining: 3, nextAllowedAt: null, quietNow: false, timezone: "Europe/Berlin", guidanceConfirmed: true, history: [] };
  await page.route("**/api/merchant/wallet-messages?*", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(overview) }));
  try {
    await page.evaluate(() => localStorage.removeItem("loynara-wallet-message-draft"));
    await page.goto("/merchant/wallet-messages");
    const field = page.locator("#wm-text"), next = page.getByRole("button", { name: "Weiter", exact: true });
    await expect(next).toBeEnabled();
    await next.click();
    await expect(field).toBeFocused();
    await expect(page.locator("#wm-error")).toHaveText("Bitte schreib eine Nachricht.");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nachricht senden");
    await page.route("**/api/merchant/wallet-messages?*", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...overview, quietNow: true }) }));
    await page.reload();
    await expect(page.getByRole("button", { name: "Weiter", exact: true })).toBeDisabled();
  } finally { await page.unrouteAll({ behavior: "ignoreErrors" }); }
});
