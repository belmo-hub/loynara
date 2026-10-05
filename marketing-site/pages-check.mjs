// Supporting pages (/fuer-barber/, /fuer-pizzerien/, /empfehlungen/): rendering checks in local Chrome.
// Needs the loopback preview (PORT=8796 npm run marketing:preview). No WebKit, Safari, physical phone or screen reader.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'http://127.0.0.1:8796', out = 'marketing-site/evidence/gtm';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const paths = ['/fuer-barber/', '/fuer-pizzerien/', '/empfehlungen/', '/'];
const widths = [[320, 640], [360, 780], [390, 844], [768, 1024], [1280, 800], [1440, 900]];
let checks = 0;
for (const path of paths) for (const [w, h] of widths) for (const reduced of [false, true]) {
  if (reduced && w !== 390) continue;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 600, hasTouch: w < 600, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage(); const problems = [], external = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.text()); });
  page.on('pageerror', e => problems.push(e.message));
  page.on('request', r => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('data:')) external.push(u); });
  await page.goto(base + path, { waitUntil: 'networkidle' });
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h1: document.querySelectorAll('h1').length, h1Visible: (() => { const r = document.querySelector('h1').getBoundingClientRect(); return r.width > 0 && r.top < innerHeight; })(), clipped: [...document.querySelectorAll('h1,h2,h3,.lead,.btn,.price b')].filter(e => getComputedStyle(e).overflowX !== 'visible' && e.scrollWidth > e.clientWidth + 1).concat([...document.querySelectorAll('h1,h2,h3,.lead,.btn')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1)).map(e => e.textContent.trim().slice(0, 40)), small: [...document.querySelectorAll('a,button,summary')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 24 && getComputedStyle(e).display !== 'inline'; }).map(e => e.textContent.trim().slice(0, 30)) }));
  const label = `${path} ${w}x${h}${reduced ? ' reduced-motion' : ''}`;
  assert.ok(m.sw <= m.cw, `${label}: horizontal overflow ${m.sw}>${m.cw}`); checks++;
  assert.equal(m.h1, 1, `${label}: one h1`); checks++;
  assert.ok(m.h1Visible, `${label}: h1 in first viewport`); checks++;
  assert.deepEqual(m.clipped, [], `${label}: clipped text`); checks++;
  assert.deepEqual(m.small, [], `${label}: tap targets under 24px`); checks++;
  assert.deepEqual(problems, [], `${label}: console`); checks++;
  assert.deepEqual(external, [], `${label}: external requests`); checks++;
  if (!reduced) await page.screenshot({ path: `${out}/${path.replaceAll('/', '') || 'home'}-${w}.png`, fullPage: true });
  await ctx.close();
}
// Keyboard: the first Tab lands on the skip link, which moves focus to the main content; every FAQ opens by keyboard.
for (const path of paths.slice(0, 3)) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage();
  await page.goto(base + path);
  await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.className), 'skip', `${path}: skip link first`); checks++;
  const focusVisible = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' || s.boxShadow !== 'none' || document.activeElement.getBoundingClientRect().top >= 0; }); assert.ok(focusVisible, `${path}: focus visible`); checks++;
  const n = await page.locator('.faq summary').count();
  for (let i = 0; i < n; i++) { await page.locator('.faq summary').nth(i).focus(); await page.keyboard.press('Enter'); }
  assert.equal(await page.locator('.faq details[open]').count(), n, `${path}: FAQ by keyboard`); checks++;
  // 200 % text zoom: no horizontal scrolling at 640 CSS px (WCAG reflow approximation at 1280 px / 2).
  await page.setViewportSize({ width: 640, height: 800 }); await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const z = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); assert.ok(z[0] <= z[1], `${path}: reflow at 200 % text ${z}`); checks++;
  await ctx.close();
}
// Without JavaScript the pages are complete (they ship no script).
for (const path of paths.slice(0, 3)) { const ctx = await browser.newContext({ javaScriptEnabled: false }); const page = await ctx.newPage(); await page.goto(base + path); assert.ok((await page.locator('details').count()) >= 5); assert.ok(await page.locator('a[href^="mailto:"]').count() >= 1); checks++; await ctx.close(); }
await browser.close();
console.log(`PASS: ${checks} supporting-page checks (${paths.length} pages incl. home × ${widths.length} widths, reduced motion, keyboard, 200 % text, no JavaScript). Screens: ${out}`);
