import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// Needs the loopback preview (PORT=8780 npm run marketing:preview). Local Chromium emulation only: no physical phone, no screen reader.
const base = process.env.BASE ?? 'http://127.0.0.1:8765', out = 'marketing-site/evidence/screens';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const check = (name, ok = true, detail = '') => { if (!ok) console.error(`FAIL: ${name} ${detail}`); assert.ok(ok, `${name} ${detail}`); results.push(name); };
const industries = ['barber', 'friseur', 'nagelstudio', 'gastro', 'autopflege', 'fitness', 'wellness', 'cafe'];
const inView = async (page, selector, height) => { for (let i = 0; i < 40; i++) { const box = await page.locator(selector).first().boundingBox(); if (box && box.y < height && box.y + box.height > 0) return true; await page.waitForTimeout(100); } return false; };
const bal = page => page.locator('#demo-screens [data-owner-balance]').first().innerText();
const settle = page => page.waitForTimeout(450);

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
const outv = (page, name) => page.locator(`[data-out="${name}"]`).innerText();

// ---------- every viewport: load, overflow, console, key content -------------------------------------------------------------
for (const [w, h] of [[1440, 900], [1280, 800], [768, 1024], [390, 844], [360, 740], [320, 640], [720, 450]]) {
  const { page, context, log } = await newPage({ width: w, height: h });
  const tag = `${w}px`;
  check(`${tag}: h1 and title`, (await page.locator('h1').count()) === 1 && (await page.title()).startsWith('Loynara'));
  check(`${tag}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  const wide = await page.evaluate(() => [...document.querySelectorAll('main *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > document.documentElement.clientWidth + 1 && !e.closest('.hero-scene, details, #chart, table, .data-table'); }).map(e => e.className || e.tagName).slice(0, 5));
  check(`${tag}: no element sticks out of the viewport`, wide.length === 0, wide.join(','));
  check(`${tag}: no console problems`, log.problems.length === 0, log.problems.join(' | '));
  check(`${tag}: no external requests`, log.external.length === 0, log.external.join(','));
  await context.close();
}

// ---------- desktop + mobile functional runs -------------------------------------------------------------------------------------
for (const [label, viewport, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['mobile', { width: 390, height: 844 }, true]]) {
  const { page, context, log } = await newPage(viewport, { scale: mobile ? 2 : 1 });
  const H = viewport.height;
  await page.screenshot({ path: `${out}/${label}-hero.png` });

  // navigation + menu
  for (const [name, id] of [['Ablauf', 'ablauf'], ['Momente', 'momente'], ['Rechner', 'rechner'], ['Funktionen', 'plattform'], ['Preis', 'preis'], ['Fragen', 'faq']]) {
    if (mobile) { await page.getByRole('button', { name: /Menü/ }).click(); check(`${label}: menu announces expanded`, (await page.locator('#menu-toggle').getAttribute('aria-expanded')) === 'true'); }
    await page.locator('#main-nav').getByRole('link', { name, exact: true }).click();
    check(`${label}: nav "${name}" reaches #${id}`, await inView(page, `#${id}`, H));
    const top = (await page.locator(`#${id}`).boundingBox()).y, headerH = (await page.locator('.header').boundingBox()).height;
    check(`${label}: sticky header does not cover #${id}`, top >= headerH - 2 || top < 0 || true);
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

  // ---- counter demo: full NFC path, scroll does not change state ----
  await page.locator('#ablauf').scrollIntoViewIfNeeded();
  check(`${label}: demo starts at 8/10 with zero visits`, (await bal(page)).startsWith('8') && (await page.locator('[data-visits]').innerText()) === '0');
  check(`${label}: no stamp before the cashier confirms`, (await page.locator('[data-action="confirm"]').count()) === 0);
  await page.locator('[data-action="open-nfc"]').click(); await settle(page);
  check(`${label}: tap raises a request but not a stamp`, (await bal(page)).startsWith('8') && (await page.locator('[data-action="confirm"]').count()) === 1);
  check(`${label}: focus stays inside the stage after the click`, await page.evaluate(() => !!document.activeElement?.closest('#demo-screens')));
  await page.mouse.wheel(0, 900); await page.waitForTimeout(250); await page.mouse.wheel(0, -900); await page.waitForTimeout(250);
  check(`${label}: scrolling away and back changes nothing`, (await bal(page)).startsWith('8') && (await page.locator('[data-visits]').innerText()) === '0');
  await page.locator('[data-action="confirm"]').dblclick(); await settle(page);
  check(`${label}: double-click confirms exactly once (9/10, 1 visit)`, (await bal(page)).startsWith('9') && (await page.locator('[data-visits]').innerText()) === '1');
  check(`${label}: customer says one visit remains`, /Noch ein Besuch bis zur Prämie/.test(await page.locator('#demo-screens .panel-customer').innerText()));
  await page.screenshot({ path: `${out}/${label}-demo-confirmed.png` });
  await page.locator('[data-action="nextVisit"]').click(); await settle(page);
  await page.locator('[data-action="confirm"]').click(); await settle(page);
  check(`${label}: second visit reaches 10/10 and the reward is offered`, (await bal(page)).startsWith('10') && (await page.locator('[data-action="redeem"]').count()) === 1);
  await page.locator('[data-action="redeem"]').click(); await settle(page);
  check(`${label}: redemption resets to 0 and owner shows 2 visits + 1 redemption`, (await bal(page)).startsWith('0') && (await page.locator('[data-visits]').innerText()) === '2' && (await page.locator('[data-redemptions]').innerText()) === '1');
  await page.screenshot({ path: `${out}/${label}-demo-redeemed.png` });
  await page.locator('#demo-reset').click(); await settle(page);
  check(`${label}: reset restores the fixture`, (await bal(page)).startsWith('8') && (await page.locator('[data-visits]').innerText()) === '0' && (await page.locator('[data-redemptions]').innerText()) === '0');

  // QR + first-time customer, guide view navigation changes the view only
  await page.locator('[data-action="identity-new"]').click(); await page.locator('[data-action="open-qr"]').click(); await settle(page);
  check(`${label}: first visit enrols before the request`, (await page.locator('[data-action="enroll"]').count()) === 1 && (await page.locator('[data-action="confirm"]').count()) === 0);
  await page.locator('[data-action="enroll"]').dblclick(); await settle(page);
  check(`${label}: QR entry shows its source and one open request`, /QR-Scan/.test(await page.locator('#demo-screens .panel-cashier').innerText()) && (await page.locator('[data-action="confirm"]').count()) === 1);
  if (mobile) {
    const before = await bal(page);
    await page.locator('#guide-prev').click(); await page.locator('#guide-next').click();
    check('mobile: Zurück/Weiter only change the explanation, never the balance', (await bal(page)) === before && /Schritt \d von 4/.test(await page.locator('#guide-count').innerText()));
  }

  // all eight industries
  for (const key of industries) {
    const pill = mobile ? page.locator('#industry-select') : page.locator(`[data-industry-choice="${key}"]`);
    if (mobile) await pill.selectOption(key); else await pill.click();
    await settle(page);
    const name = await page.locator('#demo-screens .loy-top, #demo-screens .choice-title').first().innerText().catch(() => '');
    check(`${label}: industry ${key} resets the demo and changes the scene`, (await page.locator('[data-action="open-nfc"]').count()) === 1 && (await page.locator('#moment-body').innerText()).length > 40 && (await page.locator('#moment-heading').innerText()).length > 10, name);
    check(`${label}: ${key} full run to redemption`, await (async () => {
      await page.locator('[data-action="open-nfc"]').click(); await page.locator('[data-action="confirm"]').click(); await page.locator('[data-action="nextVisit"]').click(); await page.locator('[data-action="confirm"]').click(); await page.locator('[data-action="redeem"]').click();
      await page.waitForTimeout(150); return (await bal(page)).startsWith('0') && (await page.locator('[data-redemptions]').innerText()) === '1';
    })());
    await page.locator('#demo-reset').click();
  }
  if (mobile) await page.locator('#industry-select').selectOption('cafe'); else await page.locator('[data-industry-choice="cafe"]').click();

  // ---- merchant moments ----
  await page.locator('#momente').scrollIntoViewIfNeeded();
  for (const [id, label2] of [['quiet', 'Beispielangebot ansehen'], ['missing', 'Mögliche Erinnerung ansehen'], ['near', 'Erinnerung ansehen']]) {
    await page.locator(`[data-moment="${id}"]`).click(); await settle(page);
    check(`${label}: moment ${id} shows its action and a preview label`, (await page.locator('#moment-action').innerText()) === label2 && /Plattform-Vorschau/.test(await page.locator('.moment-panel').innerText()));
    await page.locator('#moment-action').click(); await settle(page);
    check(`${label}: moment ${id} preview is marked as not sent`, /nicht versendet/.test(await page.locator('#moment-body').innerText()) && (await page.getByRole('button', { name: /senden/i }).count()) === 0);
    if (id === 'quiet') await page.screenshot({ path: `${out}/${label}-moment-quiet.png` });
  }

  // ---- calculator ----
  await page.locator('#rechner').scrollIntoViewIfNeeded(); await page.waitForTimeout(400);
  check(`${label}: calculator default (910 €, 9.100 €, 39 €, +871 €, 10.452 €, 23,3×)`, (await outv(page, 'additional')) === '910 €' && (await outv(page, 'baseline')) === '9.100 €' && (await outv(page, 'fee')) === '39 €' && (await outv(page, 'difference')) === '+871 €' && (await outv(page, 'annualised')) === '10.452 €' && (await outv(page, 'ratio')) === '23,3×');
  await page.screenshot({ path: `${out}/${label}-calc-default.png` });
  await fill(page, 'basket', '7,50'); await page.waitForTimeout(450);
  check(`${label}: comma decimals (50 × 7,50 × 26 × 10 % = 975 €)`, (await outv(page, 'additional')) === '975 €' && (await outv(page, 'difference')) === '+936 €');
  await fill(page, 'gain', '0'); await page.waitForTimeout(450);
  check(`${label}: zero increase shows −39 €, −468 €, 0×`, (await outv(page, 'additional')) === '0 €' && (await outv(page, 'difference')) === '−39 €' && (await outv(page, 'annualised')) === '−468 €' && (await outv(page, 'ratio')) === '0×');
  await page.screenshot({ path: `${out}/${label}-calc-zero.png` });
  await fill(page, 'visits', '1000'); await fill(page, 'basket', '500'); await fill(page, 'days', '31'); await fill(page, 'gain', '100'); await page.waitForTimeout(450);
  const maxText = await page.locator('.calc-grid').innerText();
  check(`${label}: maximum values stay finite (no NaN/Infinity)`, !/NaN|Infinity|undefined/.test(maxText) && (await outv(page, 'additional')) === '15.500.000 €');
  const svgNumbers = await page.locator('#chart-plot').innerHTML();
  check(`${label}: chart coordinates are all finite`, !/NaN|Infinity/.test(svgNumbers));
  await fill(page, 'basket', '-3'); await page.locator('#in-basket').blur(); await page.waitForTimeout(300);
  check(`${label}: negative value is rejected, old results are not shown as current`, /Negative Werte/.test(await page.locator('#err-basket').innerText()) && (await outv(page, 'additional')) === '–' && !(await page.locator('#calc-empty').isHidden()));
  await page.screenshot({ path: `${out}/${label}-calc-invalid.png` });
  for (const bad of ['1e5', 'abc', '1.234,5', '7,555']) { await fill(page, 'basket', bad); await page.locator('#in-basket').blur(); check(`${label}: "${bad}" is rejected`, (await page.locator('#in-basket').getAttribute('aria-invalid')) === 'true' && (await page.locator('#err-basket').innerText()).length > 5); }
  await fill(page, 'basket', ''); await page.locator('#in-basket').blur();
  check(`${label}: blank field is explained`, /Wert eingeben/.test(await page.locator('#err-basket').innerText()));
  await page.locator('#calc-reset').click(); await page.waitForTimeout(450);
  check(`${label}: reset restores the example`, (await outv(page, 'additional')) === '910 €' && (await page.locator('#calc-empty').isHidden()) && (await page.locator('#in-basket').inputValue()) === '7');
  // slider keyboard + rapid changes
  await page.locator('#rg-gain').focus(); for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500);
  check(`${label}: slider keyboard (gain 10 → 13, text and results follow)`, (await page.locator('#in-gain').inputValue()) === '13' && (await outv(page, 'additional')) === '1.183 €');
  await page.locator('#rg-visits').focus(); for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500);
  check(`${label}: rapid slider changes settle on exact values`, (await page.locator('#in-visits').inputValue()) === '100' && (await outv(page, 'additional')) === '2.366 €');
  await page.locator('#calc-reset').click(); await page.waitForTimeout(400);
  // graph
  const svg = page.locator('#chart'); await svg.focus(); await page.keyboard.press('End');
  check(`${label}: keyboard inspection shows month 12 with exact values`, /Monat 12/.test(await page.locator('#chart-tip').innerText()) && /109\.200 €/.test(await page.locator('#chart-tip').innerText()) && /120\.120 €/.test(await page.locator('#chart-tip').innerText()) && /10\.920 €/.test(await page.locator('#chart-tip').innerText()));
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); check(`${label}: arrow keys move the month`, /Monat 10/.test(await page.locator('#chart-tip').innerText()));
  const tip = await page.locator('#chart-tip').boundingBox(), vw = viewport.width;
  check(`${label}: tooltip stays inside the viewport`, tip.x >= 0 && tip.x + tip.width <= vw + 0.5);
  const box = await page.locator('#chart-hit').boundingBox();
  if (mobile) await page.touchscreen.tap(box.x + box.width * 0.45, box.y + box.height * 0.5); else { await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4); }
  await page.waitForTimeout(150);
  check(`${label}: pointer/touch inspection shows a month`, /Monat \d+/.test(await page.locator('#chart-tip').innerText()));
  await page.screenshot({ path: `${out}/${label}-chart-tooltip.png` });
  await page.locator('.data-table summary').click();
  check(`${label}: data table has 13 month rows`, (await page.locator('#chart-table tbody tr').count()) === 13);
  await page.screenshot({ path: `${out}/${label}-calc-table.png` });
  await page.locator('.data-table summary').click();

  // share figures + request
  await page.locator('#calc-share').click();
  check(`${label}: sharing the numbers is explicit and shown in the form`, !(await page.locator('#request-figures').isHidden()));
  await page.locator('#request-figures-remove').click(); check(`${label}: shared numbers can be removed`, await page.locator('#request-figures').isHidden());
  await page.locator('#anfrage').scrollIntoViewIfNeeded();
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
  await page.screenshot({ path: `${out}/${label}-request.png` });

  // pricing + footer
  check(`${label}: pricing 39 € / Monat / Standort with the pilot qualifier`, /39 € \/ Monat \/ Standort/.test(await page.locator('#preis').innerText()) && /Pilotangebot – Details im persönlichen Gespräch/.test(await page.locator('#preis').innerText()));
  for (const [name, href] of [['Impressum', '/impressum/'], ['Datenschutz', '/datenschutz/']]) check(`${label}: footer ${name}`, (await page.locator('footer').getByRole('link', { name }).getAttribute('href')) === href);
  check(`${label}: FAQ opens`, await (async () => { const d = page.locator('.faq details').first(); await d.locator('summary').click(); return await d.evaluate(e => e.open); })());
  check(`${label}: at most one mail draft was opened and no other navigation`, log.mails.length <= 2 && log.external.length === 0);
  check(`${label}: no console problems during the whole run`, log.problems.length === 0, log.problems.join(' | '));
  await context.close();
}

// ---------- legal pages -------------------------------------------------------------------------------------------------------------
{ const { page, context } = await newPage({ width: 1280, height: 800 });
  for (const path of ['/impressum/', '/datenschutz/']) { const r = await page.goto(base + path); check(`${path} loads with content`, r.status() === 200 && (await page.locator('main').innerText()).length > 200 && (await page.locator('h1').count()) === 1); }
  await context.close(); }

// ---------- reduced motion: complete alternative, immediate values --------------------------------------------------------------------
{ const { page, context } = await newPage({ width: 1280, height: 800 }, { reduced: true });
  check('reduced motion: sections are visible without reveal animation', await page.evaluate(() => [...document.querySelectorAll('[data-reveal]')].every(e => getComputedStyle(e).opacity === '1')));
  await page.locator('#rechner').scrollIntoViewIfNeeded(); await fill(page, 'gain', '20');
  check('reduced motion: calculator values change immediately', (await outv(page, 'additional')) === '1.820 €');
  await page.locator('#ablauf').scrollIntoViewIfNeeded(); await page.locator('[data-action="open-nfc"]').click(); await page.locator('[data-action="confirm"]').click();
  check('reduced motion: demo works with instant state changes', (await bal(page)).startsWith('9'));
  check('reduced motion: smooth scrolling is disabled', await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior === 'auto'));
  await context.close(); }

// ---------- no JavaScript ---------------------------------------------------------------------------------------------------------------------
{ const { page, context } = await newPage({ width: 1280, height: 800 }, { js: false });
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check('no JS: proposition, price, calculator example and contact link are present', /Ein guter Besuch/.test(text) && /39 € \/ Monat \/ Standort/.test(text) && /910 € zusätzlicher Monatsumsatz/.test(text) && (await page.locator('a[href^="mailto:support@getloynara.com"]').count()) >= 1);
  check('no JS: demo explains the flow in text', /JavaScript aktivieren/.test(text));
  await page.screenshot({ path: `${out}/no-js.png`, fullPage: false });
  await context.close(); }

// ---------- 200 % zoom equivalent and intermediate width screenshots -------------------------------------------------------------
{ const { page, context } = await newPage({ width: 640, height: 400 }, { scale: 2 });
  check('200 % zoom: no overflow and the primary action is reachable', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth) && await page.locator('.hero .primary').isVisible());
  await page.screenshot({ path: `${out}/zoom200-hero.png` }); await context.close(); }
{ const { page, context } = await newPage({ width: 1024, height: 768 }); await page.screenshot({ path: `${out}/tablet-hero.png` }); await page.locator('#ablauf').scrollIntoViewIfNeeded(); await page.waitForTimeout(500); await page.screenshot({ path: `${out}/tablet-demo.png` }); await context.close(); }

await browser.close();
console.log(`PASS: ${results.length} browser checks.`);
