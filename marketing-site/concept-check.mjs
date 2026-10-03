import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

// Functional checks for the design-concept prototypes. Needs a concept build (MARKETING_CONCEPTS=true) and the loopback preview.
// Local Chromium (system Chrome) only.
const base = process.env.BASE ?? 'http://127.0.0.1:8765';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let n = 0;
const check = (name, ok, detail = '') => { if (!ok) console.error(`FAIL: ${name} ${detail}`); assert.ok(ok, `${name} ${detail}`); n++; };
const out = (p, k) => p.locator(`[data-out="${k}"]`).first().textContent();

for (const c of ['a', 'b', 'c']) {
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 700, hasTouch: w < 700 });
    const p = await ctx.newPage(); const errs = [], external = [];
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    p.on('request', r => { if (!r.url().startsWith(base)) external.push(r.url()); });
    await p.goto(`${base}/concept-${c}/`); await p.waitForTimeout(600);
    const t = `${c}@${w}`;
    check(`${t}: one h1, noindex`, (await p.locator('h1').count()) === 1 && (await p.locator('meta[name=robots]').getAttribute('content')) === 'noindex,nofollow');
    // calculator: same maths as the live site
    check(`${t}: calculator example 910 / +871 / +10.452`, (await out(p, 'additional')) === '910 €' && (await out(p, 'difference')) === '+871 €' && (await out(p, 'annualised')) === '+10.452 €');
    const gain = p.locator('[data-in="gain"]');
    await gain.fill('0'); await p.waitForTimeout(100);
    check(`${t}: zero increase is honest (0 €, −39 €, −468 €)`, (await out(p, 'additional')) === '0 €' && (await out(p, 'difference')) === '−39 €' && (await out(p, 'annualised')) === '−468 €');
    await gain.fill('abc'); await gain.blur(); await p.waitForTimeout(100);
    check(`${t}: invalid input is explained and blanks the result`, (await out(p, 'additional')) === '–' && (await gain.getAttribute('aria-invalid')) === 'true' && (await p.locator('[data-err="gain"]').textContent()).length > 5);
    await p.locator('[data-in="basket"]').fill('7,50'); await gain.fill('10'); await p.waitForTimeout(100);
    check(`${t}: comma decimals (975 €)`, (await out(p, 'additional')) === '975 €');
    await p.locator('[data-calc-reset]').click();
    check(`${t}: reset restores the example`, (await out(p, 'additional')) === '910 €' && (await p.locator('[data-in="basket"]').inputValue()) === '7');
    await p.locator('[data-range="gain"]').focus(); for (let i = 0; i < 4; i++) await p.keyboard.press('ArrowRight');
    check(`${t}: slider keyboard updates text and result (12 % → 1.092 €)`, (await gain.inputValue()) === '12' && (await out(p, 'additional')) === '1.092 €');
    check(`${t}: chart renders without NaN`, !/NaN|Infinity/.test(await p.locator('[data-chart]').innerHTML()) && (await p.locator('[data-chart] path.line').count()) === 2 || (c === 'a' && (await p.locator('details.more').evaluate(d => !d.open))));
    // visit flow (demo.ts): exactly one stamp per confirmation, repeated clicks are idempotent
    const act = p.locator('[data-visit-act]');
    if (c === 'b') {
      const labels = [];
      for (let i = 0; i < 5; i++) { labels.push(await act.textContent()); await act.click(); await p.waitForTimeout(60); }
      check(`${t}: visit cycle open → confirm → next → confirm → redeem`, labels.join('|') === 'Karte öffnen|Besuch bestätigen|Nächsten Besuch zeigen|Besuch bestätigen|Prämie einlösen' && /2 bestätigte Besuche · 1 Prämie eingelöst/.test(await p.locator('[data-bind="summary"]').textContent()));
      check(`${t}: after redemption the card shows 0/10`, /0 von 10/.test(await p.locator('#besuch .lcard').getAttribute('aria-label')));
    } else {
      await act.click(); await act.click({ force: true }).catch(() => {}); await p.waitForTimeout(80);
      check(`${t}: confirm adds exactly one stamp (8 → 9) and cannot repeat`, /9 von 10/.test(await p.locator('[data-visit] [data-card] .lcard').first().getAttribute('aria-label')) && await act.isDisabled());
      if (c === 'a') check(`${t}: owner counter follows with correct singular`, (await p.locator('[data-bind="visits"]').textContent()) === '1' && (await p.locator('[data-bind="visits-label"]').textContent()) === 'bestätigter Besuch heute');
      await p.locator('[data-visit-reset]').click();
      check(`${t}: reset returns to 8/10`, /8 von 10/.test(await p.locator('[data-visit] [data-card] .lcard').first().getAttribute('aria-label')) && !(await act.isDisabled()));
    }
    // referral (B is interactive): no bonus until the first confirmed visit, exactly one bonus
    if (c === 'b') {
      const ref = p.locator('[data-ref-act]'), a = () => p.locator('[data-bind="a"]').textContent();
      for (const step of ['share', 'open', 'join']) { await ref.click(); check(`${t}: referral ${step} earns nothing`, (await a()) === '7'); }
      await ref.click(); check(`${t}: confirmed first visit books one bonus (7 → 8, friend 1)`, (await a()) === '8' && (await p.locator('[data-bind="b"]').textContent()) === '1');
      check(`${t}: all referral steps done`, (await p.locator('[data-ref-step].done').count()) === 4);
    }
    // tabs: aria + keyboard; selecting a view never runs an action
    for (const list of await p.locator('[data-tabs]').all()) {
      const tabs = list.locator('[role=tab]'), count = await tabs.count();
      await tabs.first().focus(); await p.keyboard.press('ArrowRight');
      const sel = await list.locator('[aria-selected=true]').getAttribute('data-view'), panel = await list.getAttribute('data-tabs');
      check(`${t}: tabs ${panel}: arrow key selects the next view, focus stays on the tab, one panel part visible`, sel === await tabs.nth(1).getAttribute('data-view') && await p.evaluate(() => document.activeElement?.getAttribute('role') === 'tab') && (await p.locator(`#${panel} > [data-show]:not([hidden]), #${panel} [data-show]:not([hidden])`).count()) >= 1);
      await p.keyboard.press('End'); check(`${t}: tabs ${panel}: End selects the last of ${count}`, (await list.locator('[aria-selected=true]').getAttribute('data-view')) === await tabs.nth(count - 1).getAttribute('data-view'));
      await p.keyboard.press('Home');
    }
    // brand: one selector changes every object in the scope, nothing else
    const before = await out(p, 'additional');
    await p.locator('[data-brand-pick="nachtblau"]').click();
    const colours = await p.locator('[data-brand-root]').evaluate(r => [...r.querySelectorAll('.stand .st-face, .lcard, .wpass')].map(e => getComputedStyle(e).getPropertyValue('--b-dark').trim()));
    check(`${t}: brand change recolours stand, card and Wallet preview together`, colours.length >= 1 && colours.every(v => v === '#16264A'), colours.join(','));
    check(`${t}: brand change leaves the calculator alone`, (await out(p, 'additional')) === before);
    check(`${t}: no console errors, no external requests`, errs.length === 0 && external.length === 0, [...errs, ...external].join(' | '));
    await ctx.close();
  }
}
// reduced motion and no JavaScript
for (const c of ['a', 'b', 'c']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }); const p = await ctx.newPage();
  await p.goto(`${base}/concept-${c}/`); await p.waitForTimeout(400);
  check(`${c}: reduced motion disables smooth scrolling and transitions`, await p.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior === 'auto' && getComputedStyle(document.querySelector('.btn')).transitionDuration === '0s'));
  await ctx.close();
  const nojs = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false }); const q = await nojs.newPage();
  await q.goto(`${base}/concept-${c}/`);
  const body = (await q.locator('body').innerText()).replace(/\s+/g, ' ');
  check(`${c}: without JavaScript the story, example result, price and contact are present`, /Ein guter Besuch/.test(body) && /910 €/.test(body) && /39 €/.test(body) && /support@getloynara\.com/.test(body));
  await nojs.close();
}
const idx = await (await browser.newContext()).newPage(); await idx.goto(`${base}/concepts/`);
check('index lists the three concepts and is noindex', (await idx.locator('.idx-list a').count()) === 3 && (await idx.locator('meta[name=robots]').getAttribute('content')) === 'noindex,nofollow');
await browser.close();
console.log(`PASS: ${n} concept checks.`);
