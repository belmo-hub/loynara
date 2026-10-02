import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Needs the loopback preview (PORT=8790 npm run marketing:preview). Local Chromium (system Chrome) only: no WebKit, no Safari, no physical phone, no screen reader.
const base = process.env.BASE ?? 'http://127.0.0.1:8765', out = 'marketing-site/evidence/screens';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const check = (name, ok = true, detail = '') => { if (!ok) console.error(`FAIL: ${name} ${detail}`); assert.ok(ok, `${name} ${detail}`); results.push(name); };
const industries = ['barber', 'friseur', 'nagelstudio', 'gastro', 'autopflege', 'fitness', 'wellness', 'cafe'];
const inView = async (page, selector, height) => { for (let i = 0; i < 40; i++) { const box = await page.locator(selector).first().boundingBox(); if (box && box.y < height && box.y + box.height > 0) return true; await page.waitForTimeout(100); } return false; };
const owner = page => page.locator('#demo-screens [data-owner-balance]').first().innerText();
const settle = page => page.waitForTimeout(450);
const jump = (page, sel) => page.evaluate(s => document.querySelector(s).scrollIntoView({ behavior: 'instant' }), sel);

async function newPage(viewport, opts = {}) {
  const context = await browser.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600, deviceScaleFactor: opts.scale ?? 1, reducedMotion: opts.reduced ? 'reduce' : 'no-preference', javaScriptEnabled: opts.js !== false, permissions: [] });
  const page = await context.newPage();
  const log = { problems: [], external: [], mails: [] };
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) log.problems.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => log.problems.push(`pageerror: ${e.message}`));
  page.on('request', r => { const u = r.url(); if (u.startsWith('mailto:')) log.mails.push(u); else if (!u.startsWith(base) && !u.startsWith('data:')) log.external.push(u); });
  await page.goto(base + '/');
  await page.waitForTimeout(700);
  return { page, context, log };
}
const fill = async (page, id, text) => { const i = page.locator(`#in-${id}`); await i.click(); await i.fill(text); };
const outv = (page, name) => page.locator(`[data-out="${name}"]`).evaluate(e => e.textContent);
const visibleBelowHeader = async (page, selector) => page.evaluate(sel => {
  const e = document.querySelector(sel); if (!e) return false;
  const r = e.getBoundingClientRect(), h = document.querySelector('.header').getBoundingClientRect().height;
  const step = document.querySelector('#stage-step'), sticky = step && getComputedStyle(step).position === 'sticky' ? step.getBoundingClientRect().height : 0;
  return r.top >= h + sticky - 1 && r.bottom <= innerHeight + 1;
}, selector);

// ---------- every viewport: load, overflow, console, key content -------------------------------------------------------------
for (const [w, h] of [[1440, 900], [1280, 800], [1024, 768], [768, 1024], [720, 450], [390, 844], [360, 740], [320, 640]]) {
  const { page, context, log } = await newPage({ width: w, height: h });
  const tag = `${w}px`;
  check(`${tag}: h1 and title`, (await page.locator('h1').count()) === 1 && (await page.title()).startsWith('Loynara'));
  check(`${tag}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  const wide = await page.evaluate(() => [...document.querySelectorAll('main *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > document.documentElement.clientWidth + 1 && !e.closest('details, #chart, table, .data-table'); }).map(e => e.className || e.tagName).slice(0, 5));
  check(`${tag}: no element sticks out of the viewport`, wide.length === 0, wide.join(','));
  check(`${tag}: no console problems`, log.problems.length === 0, log.problems.join(' | '));
  check(`${tag}: no external requests`, log.external.length === 0, log.external.join(','));
  // hero cluster: no collisions between phone, cashier and owner, owner shows an activity row, label is "Beispieldarstellung"
  const boxes = await page.evaluate(() => ['.hero-phone', '.hero-cashier', '.hero-owner'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
  const overlap = (a, b) => a[0] < b[2] - 0.5 && b[0] < a[2] - 0.5 && a[1] < b[3] - 0.5 && b[1] < a[3] - 0.5;
  check(`${tag}: hero surfaces do not collide`, !overlap(boxes[0], boxes[1]) && !overlap(boxes[0], boxes[2]) && !overlap(boxes[1], boxes[2]));
  check(`${tag}: hero owner has an activity row; label says Beispieldarstellung; no duplicate progress sentence`, (await page.locator('.hero-owner .activity li').count()) === 1 && (await page.locator('.hero-label').innerText()) === 'Beispieldarstellung' && (await page.locator('.hero-phone').innerText()).split('Prämie').length <= 3);
  // header hierarchy: Anmelden is not larger than the navigation links
  const sizes = await page.evaluate(() => { const nav = document.querySelector('#main-nav a:not(.button)'), login = document.querySelector('.nav-actions .quiet'); return [getComputedStyle(nav).fontSize, getComputedStyle(login).fontSize]; });
  check(`${tag}: Anmelden matches navigation text size`, w <= 1100 || sizes[0] === sizes[1], sizes.join('/'));
  await context.close();
}

// ---------- desktop + mobile functional runs -------------------------------------------------------------------------------------
for (const [label, viewport, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['mobile', { width: 390, height: 844 }, true]]) {
  const { page, context, log } = await newPage(viewport, { scale: mobile ? 2 : 1 });
  const H = viewport.height;
  await page.screenshot({ path: `${out}/${label}-hero.png` });

  for (const [name, id] of [['Ablauf', 'ablauf'], ['Momente', 'momente'], ['Rechner', 'rechner'], ['Funktionen', 'plattform'], ['Preis', 'preis'], ['Fragen', 'faq']]) {
    if (mobile) { await page.getByRole('button', { name: /Menü/ }).click(); check(`${label}: menu announces expanded`, (await page.locator('#menu-toggle').getAttribute('aria-expanded')) === 'true'); }
    await page.locator('#main-nav').getByRole('link', { name, exact: true }).click();
    check(`${label}: nav "${name}" reaches #${id}`, await inView(page, `#${id}`, H));
    if (mobile) check(`${label}: menu closes after navigation`, (await page.locator('#menu-toggle').getAttribute('aria-expanded')) === 'false');
  }
  if (mobile) {
    await page.getByRole('button', { name: /Menü/ }).click(); await page.screenshot({ path: `${out}/mobile-menu.png` });
    await page.keyboard.press('Escape');
    check('mobile: Escape closes menu and restores focus', (await page.locator('#menu-toggle').getAttribute('aria-expanded')) === 'false' && await page.evaluate(() => document.activeElement?.id === 'menu-toggle'));
  }
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(300);
  check(`${label}: hero CTAs`, (await page.locator('.hero .primary').getAttribute('href')) === '#anfrage' && (await page.locator('.hero .secondary').getAttribute('href')) === '#ablauf');
  check(`${label}: login link`, (await page.locator('#main-nav a[href*="app.getloynara.com/login"]').getAttribute('href')) === 'https://app.getloynara.com/login');

  // ---- counter demo: returning fixture, guide mirrors state, next control visible, scroll never changes state ----
  await jump(page, '#ablauf'); await page.waitForTimeout(400);
  const guideNow = () => page.evaluate(() => [document.querySelector('#guide li.is-current')?.getAttribute('data-step'), document.querySelector('#guide-count').textContent]);
  check(`${label}: no Zurück/Weiter controls exist`, (await page.locator('#guide-prev, #guide-next, #guide-nav').count()) === 0);
  check(`${label}: starts at the returning fixture 8/10, guide on step 1`, (await owner(page)).startsWith('8') && (await guideNow())[0] === '0' && /Schritt 1 von 4/.test((await guideNow())[1]));
  check(`${label}: no stamp before the cashier confirms`, (await page.locator('[data-action="confirm"]').count()) === 0);
  await page.locator('[data-action="open-nfc"]').click(); await page.waitForTimeout(900);
  check(`${label}: tap raises a request but not a stamp; guide moves to step 2`, (await owner(page)).startsWith('8') && (await page.locator('[data-action="confirm"]').count()) === 1 && (await guideNow())[0] === '1');
  check(`${label}: next acting control (Besuch bestätigen) is fully visible below the sticky header`, await visibleBelowHeader(page, '[data-action="confirm"]'));
  check(`${label}: focus stays inside the stage after the click`, await page.evaluate(() => !!document.activeElement?.closest('#demo-screens')));
  const y0 = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 1400); await page.waitForTimeout(250); await page.mouse.wheel(0, -1400); await page.waitForTimeout(250); await page.mouse.wheel(0, 700); await page.waitForTimeout(250);
  check(`${label}: scrolling away and back changes neither state nor guide`, (await owner(page)).startsWith('8') && (await page.locator('[data-visits]').innerText()) === '0' && (await guideNow())[0] === '1');
  await jump(page, '#stage'); await page.waitForTimeout(300);
  await page.locator('[data-action="confirm"]').dblclick(); await page.waitForTimeout(900);
  check(`${label}: double-click confirms exactly once (9/10, 1 visit); guide step 3; next control visible`, (await owner(page)).startsWith('9') && (await page.locator('[data-visits]').innerText()) === '1' && (await guideNow())[0] === '2' && await visibleBelowHeader(page, '[data-action="nextVisit"]'));
  check(`${label}: customer says one visit remains`, /Noch ein Besuch bis zur Prämie/.test(await page.locator('#demo-screens .panel-customer').innerText()));
  await page.screenshot({ path: `${out}/${label}-demo-confirmed.png` });
  await page.locator('[data-action="nextVisit"]').click(); await page.waitForTimeout(800);
  check(`${label}: second request: confirm control visible`, await visibleBelowHeader(page, '[data-action="confirm"]'));
  await page.locator('[data-action="confirm"]').click(); await page.waitForTimeout(800);
  check(`${label}: reaches 10/10; reward offered; guide step 4; redeem control visible`, (await owner(page)).startsWith('10') && (await guideNow())[0] === '3' && await visibleBelowHeader(page, '[data-action="redeem"]'));
  await page.locator('[data-action="redeem"]').click(); await page.waitForTimeout(900);
  check(`${label}: redemption resets to 0; owner shows 2 visits + 1 redemption; result visible`, (await owner(page)).startsWith('0') && (await page.locator('[data-visits]').innerText()) === '2' && (await page.locator('[data-redemptions]').innerText()) === '1' && await visibleBelowHeader(page, '.panel-owner'));
  await page.screenshot({ path: `${out}/${label}-demo-redeemed.png` });
  await page.locator('#demo-reset').click(); await settle(page);
  check(`${label}: reset restores the returning fixture`, (await owner(page)).startsWith('8') && (await page.locator('[data-visits]').innerText()) === '0' && (await page.locator('[data-redemptions]').innerText()) === '0' && (await guideNow())[0] === '0');

  // ---- NEW card: 0 -> 1, no invented history, fixtures stay separate ----
  await page.locator('[data-action="identity-new"]').click(); await settle(page);
  check(`${label}: new fixture labelled and starts without a card`, /Noch keine Karte angelegt/.test(await page.locator('.panel-owner').innerText()) && /0 von 10/.test(await page.locator('.segmented').innerText()));
  await page.locator('[data-action="open-qr"]').click(); await page.waitForTimeout(800);
  check(`${label}: first visit enrols before any request`, (await page.locator('[data-action="enroll"]').count()) === 1 && (await page.locator('[data-action="confirm"]').count()) === 0 && await visibleBelowHeader(page, '[data-action="enroll"]'));
  await page.locator('[data-action="enroll"]').dblclick(); await page.waitForTimeout(800);
  check(`${label}: new card starts at 0 / 10 (customer and owner agree), one open QR request`, (await page.locator('#demo-screens [data-balance]').first().innerText()).startsWith('0') && (await owner(page)).startsWith('0') && /QR-Scan · Neue Karte/.test(await page.locator('.panel-cashier').innerText()) && (await page.locator('[data-visits]').innerText()) === '0');
  await page.locator('[data-action="confirm"]').click(); await page.waitForTimeout(800);
  check(`${label}: new card earns exactly 1 after confirmation; no earlier activity`, (await page.locator('#demo-screens [data-balance]').first().innerText()).startsWith('1') && (await owner(page)).startsWith('1') && (await page.locator('[data-visits]').innerText()) === '1' && (await page.locator('.panel-owner .activity li').count()) === 1);
  check(`${label}: guide explains that progress begins with the first confirmed visit`, /Fortschritt beginnt mit dem ersten bestätigten Besuch/.test(await page.locator('#guide li.is-current').innerText()) && (await page.locator('[data-action="nextVisit"]').count()) === 0);
  await page.screenshot({ path: `${out}/${label}-new-confirmed.png` });
  await page.locator('[data-action="use-returning"]').click(); await settle(page);
  check(`${label}: switching to the returning fixture loads 8/10 cleanly`, (await owner(page)).startsWith('8') && (await page.locator('[data-visits]').innerText()) === '0' && (await page.locator('.segmented [aria-pressed="true"]').innerText()).startsWith('Bestandskarte'));

  // owner metric values align regardless of label wrapping
  const tops = await page.evaluate(() => [...document.querySelectorAll('#demo-screens .panel-owner .metrics strong')].map(e => Math.round(e.getBoundingClientRect().bottom)));
  check(`${label}: owner metric values share one baseline`, tops.length === 2 && Math.abs(tops[0] - tops[1]) <= 1, tops.join('/'));
  // stage label and reset are legible and stay together
  const head = await page.evaluate(() => { const b = document.querySelector('.stage-head .badge').getBoundingClientRect(), r = document.querySelector('.reset-button').getBoundingClientRect(); return { badgeH: b.height, resetH: r.height, sameLine: Math.abs((b.top + b.height / 2) - (r.top + r.height / 2)) < 30 || r.top > b.bottom }; });
  check(`${label}: stage badge is one line and reset button text+icon stay on one line`, head.badgeH < 34 && head.resetH <= 48);

  // all eight industries
  for (const key of industries) {
    if (mobile) await page.locator('#industry-select').selectOption(key); else await page.locator(`[data-industry-choice="${key}"]`).click();
    await settle(page);
    check(`${label}: industry ${key} resets the demo, keeps the fixture and changes the scene`, (await page.locator('[data-action="open-nfc"]').count()) === 1 && (await page.locator('#moment-body').innerText()).length > 40);
    check(`${label}: ${key} full run to redemption`, await (async () => {
      await page.locator('[data-action="open-nfc"]').click(); await page.locator('[data-action="confirm"]').click(); await page.locator('[data-action="nextVisit"]').click(); await page.locator('[data-action="confirm"]').click(); await page.locator('[data-action="redeem"]').click();
      await page.waitForTimeout(150); return (await owner(page)).startsWith('0') && (await page.locator('[data-redemptions]').innerText()) === '1';
    })());
    await page.locator('#demo-reset').click();
  }

  // ---- business moments: outlook labelling, grammar of every industry ----
  await jump(page, '#momente'); await page.waitForTimeout(400);
  for (const [id, cta] of [['quiet', 'Beispielangebot ansehen'], ['missing', 'Mögliche Erinnerung ansehen'], ['near', 'Beispielnachricht ansehen']]) {
    await page.locator(`[data-moment="${id}"]`).click(); await settle(page);
    check(`${label}: moment ${id} shows the outlook badge and its action`, (await page.locator('#moment-action').innerText()) === cta && /Plattform-Ausblick – nicht im aktuellen Pilotangebot/.test(await page.locator('.moment-panel').innerText()));
    await page.locator('#moment-action').click(); await settle(page);
    const txt = await page.locator('#moment-body').innerText();
    check(`${label}: moment ${id} preview says that sending is not part of the current offer`, /Vorschau – Versand ist nicht Teil des aktuellen Angebots/.test(txt) && (await page.getByRole('button', { name: /senden/i }).count()) === 0);
    check(`${label}: moment ${id} uses conditional wording`, !/Du bemerkst|Gäste buchen|bekommt einen freundlichen Anstoß/.test(await page.locator('.moment-panel').innerText()));
    if (id === 'quiet') { await page.screenshot({ path: `${out}/${label}-moment-quiet.png` }); check(`${label}: quiet scene uses one dimension (hours 10–17, 14–16 highlighted)`, (await page.locator('.bars span').count()) === 8 && (await page.locator('.bars span.low').count()) === 3 && (await page.locator('.bar-labels span').allInnerTexts()).join(',') === '10,11,12,13,14,15,16,17'); }
  }
  const grammar = [];
  for (const key of industries) {
    if (mobile) await page.locator('#industry-select').selectOption(key); else await page.locator(`[data-industry-choice="${key}"]`).click();
    for (const id of ['quiet', 'missing', 'near']) { await page.locator(`[data-moment="${id}"]`).click(); if ((await page.locator('#moment-action').innerText()).startsWith('Vorschau ausblenden') === false) await page.locator('#moment-action').click(); grammar.push([key, id, (await page.locator('#moment-body').innerText()).replace(/\s+/g, ' ')]); }
  }
  check(`${label}: every industry shows complete, capitalised moment sentences and a working reward sentence`, grammar.every(([key, id, t]) => id !== 'near' || /Noch ein Besuch – dann wartet (ein|eine) [^.]+ auf dich\./.test(t)) && grammar.every(([, id, t]) => id !== 'missing' || /(Sie|Er|Das Mitglied) (kam|bestellte|buchte) sonst .* – jetzt sind es \d+ (Wochen|Monate)/.test(t)), JSON.stringify(grammar.filter(([, id]) => id === 'near').map(g => g[2].slice(0, 120))));
  await page.screenshot({ path: `${out}/${label}-moments-last.png` });

  // ---- calculator ----
  await jump(page, '#rechner'); await page.waitForTimeout(400);
  await page.locator('.calc-assumptions summary').click();
  check(`${label}: calculator default (910 €, 9.100 €, 39 €, +871 €, 10.452 €; ratio only in details)`, (await outv(page, 'additional')) === '910 €' && (await outv(page, 'baseline')) === '9.100 €' && (await outv(page, 'fee')) === '39 €' && (await outv(page, 'difference')) === '+871 €' && (await outv(page, 'annualised')) === '10.452 €' && (await outv(page, 'ratio')) === '23,3×');
  check(`${label}: ratio sits inside the details, outside the primary result and breakdown`, await page.evaluate(() => !!document.querySelector('.calc-assumptions [data-out="ratio"]') && !document.querySelector('#calc-breakdown [data-out="ratio"]') && !document.querySelector('.primary-figure [data-out="ratio"]')));
  check(`${label}: ratio is labelled as a revenue-to-fee comparison, not profit or ROI`, /Zusatzumsatz im Vergleich zur Monatsgebühr/.test(await page.locator('.ratio-line').innerText()) && /kein Gewinn und keine garantierte Rendite/.test(await page.locator('.calc-detail').innerText()));
  const order = await page.evaluate(() => { const y = s => document.querySelector(s).getBoundingClientRect().top; return [y('.disclaimer'), y('.calc-assumptions summary')]; });
  check(`${label}: "Annahmen im Detail" sits below the disclaimer`, order[1] > order[0]);
  await page.locator('.calc-assumptions summary').click();
  check(`${label}: month-12 gap label is shown on the chart`, /\+10\.920 € im Jahr/.test(await page.locator('#chart .gaplabel').innerHTML()));
  await page.screenshot({ path: `${out}/${label}-calc-default.png` });
  await fill(page, 'basket', '7,50'); await page.waitForTimeout(450);
  check(`${label}: comma decimals (50 × 7,50 × 26 × 10 % = 975 €)`, (await outv(page, 'additional')) === '975 €' && (await outv(page, 'difference')) === '+936 €');
  await fill(page, 'gain', '0'); await page.waitForTimeout(450);
  check(`${label}: zero increase shows −39 €, −468 € and no month-12 label`, (await outv(page, 'additional')) === '0 €' && (await outv(page, 'difference')) === '−39 €' && (await outv(page, 'annualised')) === '−468 €' && (await outv(page, 'ratio')) === '0×' && (await page.locator('#chart .gaplabel').count()) === 0 && /Differenz\s*0 €/.test((await page.locator('#chart-readout').innerText()).replace(/\n/g, ' ')));
  await page.screenshot({ path: `${out}/${label}-calc-zero.png` });
  await fill(page, 'visits', '1000'); await fill(page, 'basket', '500'); await fill(page, 'days', '31'); await fill(page, 'gain', '100'); await page.waitForTimeout(450);
  check(`${label}: maximum values stay finite`, !/NaN|Infinity|undefined/.test(await page.locator('.calc-grid').innerText()) && (await outv(page, 'additional')) === '15.500.000 €' && !/NaN|Infinity/.test(await page.locator('#chart-plot').innerHTML()));
  await fill(page, 'basket', '-3'); await page.locator('#in-basket').blur(); await page.waitForTimeout(300);
  check(`${label}: negative value is rejected and old results are not shown as current`, /Negative Werte/.test(await page.locator('#err-basket').innerText()) && (await outv(page, 'additional')) === '–' && !(await page.locator('#calc-empty').isHidden()));
  await page.screenshot({ path: `${out}/${label}-calc-invalid.png` });
  for (const bad of ['1e5', 'abc', '1.234,5', '7,555']) { await fill(page, 'basket', bad); await page.locator('#in-basket').blur(); check(`${label}: "${bad}" is rejected`, (await page.locator('#in-basket').getAttribute('aria-invalid')) === 'true' && (await page.locator('#err-basket').innerText()).length > 5); }
  await fill(page, 'basket', ''); await page.locator('#in-basket').blur();
  check(`${label}: blank field is explained`, /Wert eingeben/.test(await page.locator('#err-basket').innerText()));
  await page.locator('#calc-reset').click(); await page.waitForTimeout(450);
  check(`${label}: reset restores the example`, (await outv(page, 'additional')) === '910 €' && (await page.locator('#calc-empty').isHidden()) && (await page.locator('#in-basket').inputValue()) === '7');
  await page.locator('#rg-gain').focus(); for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500);
  check(`${label}: slider keyboard (gain 10 → 13, text and results follow)`, (await page.locator('#in-gain').inputValue()) === '13' && (await outv(page, 'additional')) === '1.183 €');
  await page.locator('#calc-reset').click(); await page.waitForTimeout(400);
  // chart readout: fixed strip outside the plot, hover/keyboard/touch equivalent
  const svg = page.locator('#chart'); await svg.focus(); await page.keyboard.press('End');
  const ro = async () => (await page.locator('#chart-readout').innerText()).replace(/\s+/g, ' ');
  check(`${label}: keyboard inspection shows month 12 with exact values in the readout`, /Monat 12/.test(await ro()) && /109\.200 €/.test(await ro()) && /120\.120 €/.test(await ro()) && /10\.920 €/.test(await ro()));
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); check(`${label}: arrow keys move the month`, /Monat 10/.test(await ro()));
  const strip = await page.locator('#chart-readout').boundingBox(), wrapBox = await page.locator('#chart-wrap').boundingBox();
  check(`${label}: the readout never overlaps the plotting area`, strip.y + strip.height <= wrapBox.y + 1);
  await page.locator('#chart').scrollIntoViewIfNeeded(); await page.evaluate(() => scrollBy(0, 120)); await page.waitForTimeout(200);
  const box = await page.locator('#chart-hit').boundingBox();
  if (mobile) await page.touchscreen.tap(box.x + box.width * 0.45, box.y + box.height * 0.5); else await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
  await page.waitForTimeout(150);
  check(`${label}: pointer/touch inspection updates the same readout`, /Monat (5|6|7)\b/.test(await ro()));
  check(`${label}: no tooltip element covers the chart`, (await page.locator('.tooltip, #chart-tip').count()) === 0);
  await page.screenshot({ path: `${out}/${label}-chart-readout.png` });
  await page.locator('.data-table summary').click();
  check(`${label}: data table has 13 month rows`, (await page.locator('#chart-table tbody tr').count()) === 13);
  await page.locator('.data-table summary').click();
  // share figures + request
  await page.locator('#calc-share').click();
  check(`${label}: sharing the numbers is explicit and shown in the form`, !(await page.locator('#request-figures').isHidden()));
  await page.locator('#request-figures-remove').click(); check(`${label}: shared numbers can be removed`, await page.locator('#request-figures').isHidden());
  await jump(page, '#anfrage');
  await page.getByRole('button', { name: /E-Mail vorbereiten/ }).click();
  check(`${label}: empty request is refused and focused`, /Namen deines Geschäfts/.test(await page.locator('#request-status').innerText()) && await page.evaluate(() => document.activeElement?.id === 'req-business'));
  await page.locator('#req-business').fill('Bäckerei & Café "Süß"'); await page.locator('#req-message').fill('Zeile 1\nZeile 2');
  await page.locator('#calc-share').evaluate(b => b.click());
  await page.getByRole('button', { name: /E-Mail vorbereiten/ }).click(); await page.waitForTimeout(200);
  const mail = decodeURIComponent(log.mails.at(-1) ?? '');
  check(`${label}: mail draft goes to support with umlauts, line breaks and the shared figures`, mail.startsWith('mailto:support@getloynara.com?subject=Demo-Anfrage Loynara – Bäckerei & Café "Süß"') && mail.includes('Zeile 1\nZeile 2') && mail.includes('Käufe pro Tag: 50') && mail.includes('kein Gewinn'));
  check(`${label}: page says nothing was sent`, /Gesendet ist noch nichts/.test(await page.locator('#request-status').innerText()) && !(await page.locator('#request-copy').isHidden()));
  await page.locator('#request-copy').click(); await page.waitForTimeout(200);
  check(`${label}: denied clipboard is handled with a fallback message`, /Kopieren war nicht möglich|Text kopiert/.test(await page.locator('#request-status').innerText()));
  const sep = await page.evaluate(() => { const l = document.querySelector('.after').getBoundingClientRect(), e = document.querySelector('.existing').getBoundingClientRect(); return e.top - l.bottom; });
  check(`${label}: "Schon dabei?" is separated from the request steps`, sep >= 24, String(sep));
  await page.screenshot({ path: `${out}/${label}-request.png` });

  // platform, setup, pricing layout
  check(`${label}: platform section has no pills, boxes or visuals; three columns/rows with explicit state labels`, (await page.locator('#plattform .platform-cols article').count()) === 3 && (await page.locator('#plattform .tags, #plattform .pvisual').count()) === 0 && /Ausblick – nicht im aktuellen Pilotangebot/i.test(await page.locator('#plattform').innerText()));
  check(`${label}: "Wallet-Karten" never breaks across lines`, await page.evaluate(() => [...document.querySelectorAll('.nb')].every(e => e.getClientRects().length === 1)));
  const price = await page.evaluate(() => { const card = document.querySelector('.price-card').getBoundingClientRect(), wrap = document.querySelector('#preis .wrap').getBoundingClientRect(), cta = document.querySelector('.price-cta').getBoundingClientRect(), fine = document.querySelector('.price-fine').getBoundingClientRect(); return { right: Math.round(wrap.right - card.right), left: Math.round(card.left - wrap.left), gap: Math.round(fine.top - cta.bottom) }; });
  check(`${label}: pricing card sits on the content grid; CTA is separated from the fine print`, Math.abs(price.right) <= 1 && Math.abs(price.left) <= 1 && price.gap >= 12, JSON.stringify(price));
  check(`${label}: pricing 39 € / Monat / Standort with the pilot qualifier`, /39 € \/ Monat \/ Standort/.test(await page.locator('#preis').innerText()) && /Pilotangebot – Details im persönlichen Gespräch/.test(await page.locator('#preis').innerText()));
  if (!mobile) { const lines = await page.evaluate(() => document.querySelector('.setup h2 em').getClientRects().length); check('desktop: setup heading second line is not split (no orphan "aus.")', lines === 1, String(lines)); }
  for (const [name, href] of [['Impressum', '/impressum/'], ['Datenschutz', '/datenschutz/']]) check(`${label}: footer ${name}`, (await page.locator('footer').getByRole('link', { name }).getAttribute('href')) === href);
  check(`${label}: FAQ opens`, await (async () => { const d = page.locator('.faq details').first(); await d.locator('summary').click(); return await d.evaluate(e => e.open); })());
  check(`${label}: no console problems during the whole run`, log.problems.length === 0, log.problems.join(' | '));
  check(`${label}: no external requests during the whole run`, log.external.length === 0, log.external.join(','));
  await context.close();
}

// ---------- 320 px: calculator fields stack and stay inside their card ---------------------------------------------------------------
{ const { page, context } = await newPage({ width: 320, height: 640 }, { scale: 2 });
  await jump(page, '#calc-form'); await page.waitForTimeout(300);
  const fits = await page.evaluate(() => { const card = document.querySelector('.calc-inputs').getBoundingClientRect(); return [...document.querySelectorAll('.field-input')].every(e => { const r = e.getBoundingClientRect(); return r.right <= card.right - 8 && r.left >= card.left; }); });
  check('320px: every calculator input (incl. basket with € unit) stays inside its card', fits);
  await fill(page, 'basket', '12,75'); await page.waitForTimeout(300);
  check('320px: typed value and result update; caret keeps working', (await page.locator('#in-basket').inputValue()) === '12,75' && (await outv(page, 'additional')) === '1.658 €');
  await page.screenshot({ path: `${out}/w320-calc.png` });
  await jump(page, '#ablauf'); await page.evaluate(() => scrollBy(0, 300)); await page.waitForTimeout(300);
  const hh = await page.evaluate(() => { const b = document.querySelector('.stage-head .badge'), r = document.querySelector('.reset-button'); return [b.getBoundingClientRect().height, r.getBoundingClientRect().height, r.getClientRects().length]; });
  check('320px: stage label and "Neu starten ↺" stay legible and unbroken', hh[0] < 34 && hh[1] <= 48);
  await page.screenshot({ path: `${out}/w320-demo.png` }); await context.close(); }

// ---------- legal pages -------------------------------------------------------------------------------------------------------------
{ const { page, context } = await newPage({ width: 1280, height: 800 });
  for (const path of ['/impressum/', '/datenschutz/']) { const r = await page.goto(base + path); check(`${path} loads with content`, r.status() === 200 && (await page.locator('main').innerText()).length > 200 && (await page.locator('h1').count()) === 1); }
  await context.close(); }

// ---------- reveal robustness: anchors, reload, Back, resize, print --------------------------------------------------------------------
{ const { page, context } = await newPage({ width: 1440, height: 900 });
  const hidden = () => page.evaluate(() => [...document.querySelectorAll('[data-reveal]')].filter(e => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && getComputedStyle(e).opacity !== '1'; }).length);
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, document.querySelector('.contrast-grid').offsetTop - 200); }); await page.waitForTimeout(900);
  check('reveals: content reached by an instant jump becomes fully visible', await hidden() === 0);
  await page.evaluate(() => scrollTo(0, document.querySelector('#moment-stage').offsetTop - 200)); await page.waitForTimeout(900);
  check('reveals: moments stage becomes fully visible after an instant jump', await hidden() === 0);
  await page.reload(); await page.waitForTimeout(1200); check('reveals: nothing visible stays hidden after a reload with restored scroll', await hidden() === 0);
  await page.goto(base + '/impressum/'); await page.waitForTimeout(300); await page.goBack(); await page.waitForTimeout(1200); check('reveals: nothing visible stays hidden after Back from a legal page', await hidden() === 0);
  await page.setViewportSize({ width: 600, height: 900 }); await page.waitForTimeout(700); check('reveals: nothing visible stays hidden after resize', await hidden() === 0);
  await context.close(); }
{ const { page, context } = await newPage({ width: 1280, height: 800 });
  await page.emulateMedia({ media: 'print' });
  const state = await page.evaluate(() => ({ revealHidden: [...document.querySelectorAll('[data-reveal]')].filter(e => getComputedStyle(e).opacity !== '1').length, headerPos: getComputedStyle(document.querySelector('.header')).position, stageStepSticky: getComputedStyle(document.querySelector('#stage-step')).position === 'sticky' }));
  check('print: all reveal content is visible before any scrolling; header is not sticky', state.revealHidden === 0 && state.headerPos === 'static' && !state.stageStepSticky, JSON.stringify(state));
  await page.screenshot({ path: `${out}/print-top.png`, fullPage: true });
  const pdf = await page.pdf({ format: 'A4', printBackground: true }); check('print: a PDF can be produced', pdf.length > 20000);
  await context.close(); }

// ---------- reduced motion + no JS --------------------------------------------------------------------------------------------------------
{ const { page, context } = await newPage({ width: 1280, height: 800 }, { reduced: true });
  check('reduced motion: sections are visible without reveal animation', await page.evaluate(() => [...document.querySelectorAll('[data-reveal]')].every(e => getComputedStyle(e).opacity === '1')));
  await jump(page, '#rechner'); await fill(page, 'gain', '20');
  check('reduced motion: calculator values change immediately', (await outv(page, 'additional')) === '1.820 €');
  await jump(page, '#ablauf'); await page.locator('[data-action="open-nfc"]').click(); await page.locator('[data-action="confirm"]').click();
  check('reduced motion: demo works with instant state changes', (await owner(page)).startsWith('9'));
  check('reduced motion: smooth scrolling is disabled', await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior === 'auto'));
  await context.close(); }
{ const { page, context } = await newPage({ width: 1280, height: 800 }, { js: false });
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check('no JS: proposition, price, calculator example and contact link are present', /Ein guter Besuch/.test(text) && /39 € \/ Monat \/ Standort/.test(text) && /910 € zusätzlicher Monatsumsatz/.test(text) && (await page.locator('a[href^="mailto:support@getloynara.com"]').count()) >= 1);
  check('no JS: demo explains the flow in text and nothing is hidden', /JavaScript aktivieren/.test(text) && await page.evaluate(() => [...document.querySelectorAll('[data-reveal]')].every(e => getComputedStyle(e).opacity === '1')));
  await context.close(); }

// ---------- screenshots at intermediate widths -----------------------------------------------------------------------------------------
for (const [w, h] of [[1280, 800], [1024, 768], [768, 1024]]) { const { page, context } = await newPage({ width: w, height: h }); await page.screenshot({ path: `${out}/w${w}-hero.png` }); await jump(page, '#ablauf'); await page.evaluate(() => scrollBy(0, 250)); await page.waitForTimeout(400); await page.screenshot({ path: `${out}/w${w}-demo.png` }); await context.close(); }
await browser.close();
console.log(`PASS: ${results.length} browser checks.`);
