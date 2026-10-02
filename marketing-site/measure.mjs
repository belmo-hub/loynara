// Repeatable layout/copy measurement (same method before and after). Chromium, fonts loaded, reveals settled, optional disclosures closed.
// BASE=http://127.0.0.1:PORT node marketing-site/measure.mjs [label]
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'http://127.0.0.1:8765', label = process.argv[2] ?? 'run', out = `marketing-site/evidence/measure-${label}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const words = t => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’.,%€\/-]*/gu) ?? []).length;
const res = {};
for (const [name, w, h] of [['1440', 1440, 900], ['390', 390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 600, hasTouch: w < 600 });
  const p = await ctx.newPage(); await p.goto(base + '/'); await p.waitForTimeout(900);
  await p.evaluate(async () => { await document.fonts.ready; const H = document.documentElement.scrollHeight; for (let y = 0; y < H; y += 400) { scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } scrollTo(0, 0); });
  await p.waitForTimeout(800);
  const m = await p.evaluate(() => {
    const main = document.querySelector('main'), top = el => el ? Math.round(el.getBoundingClientRect().top + scrollY) : null;
    const sections = [...main.children].filter(e => e.tagName === 'SECTION');
    const calc = document.querySelector('#rechner'), price = document.querySelector('.price, .price-card');
    const mods = ['#stage', '.stage-layout', '.moment-stage', '.calc-grid', '#journey', '#owner', '#studio'].map(s => document.querySelector(s)).filter(Boolean).map(e => ({ sel: e.id ? '#' + e.id : e.className.split(' ')[0], h: Math.round(e.getBoundingClientRect().height) }));
    const mockSel = '.panel, .loy-card, .stage, .phone-frame, .phone-screen, .hero-scene, .moment-stage, .calc-inputs, .calc-graph, .chart-wrap, .stand, .studio-stage, .owner-frame, .journey-stage, .request-card, details, nav, button, label, .metrics, table';
    const clone = main.cloneNode(true); clone.querySelectorAll(mockSel).forEach(e => e.remove());
    const vis = main.innerText;
    return {
      docHeight: Math.round(document.documentElement.scrollHeight), scenes: sections.length, sceneHeights: sections.map(s => [s.id || s.className.split(' ').slice(0, 2).join('.'), Math.round(s.getBoundingClientRect().height)]),
      calcTop: top(calc), priceTop: top(price), largestModules: mods.sort((a, b) => b.h - a.h).slice(0, 3),
      visibleText: vis, proseText: clone.textContent.replace(/\s+/g, ' '),
      zeroClick: { retention: /Prämie|Stempel|wiederkomm/i.test(vis), referral: /Empfehl/i.test(vis), branding: /Marke|Farben|Logo|Gestaltung|Wiedererkenn/i.test(vis), counterTouchpoint: /Tresen|Schild|Aufsteller|Stand/i.test(vis), wallet: /Wallet/i.test(vis) },
      staticHtmlText: main.textContent.replace(/\s+/g, ' '),
    };
  });
  // unique copy including optional panels: closed disclosures + every tab/scenario button
  const uniq = new Set(m.staticHtmlText.split(/(?<=[.!?:])\s+/));
  for (const sel of ['[data-moment]', '[data-owner-view]', '[data-chapter]', '[data-studio-style]']) {
    const n = await p.locator(sel).count();
    for (let i = 0; i < n; i++) { const b = p.locator(sel).nth(i); if (await b.isVisible()) { await b.click().catch(() => {}); await p.waitForTimeout(120); const t = await p.evaluate(() => document.querySelector('main').textContent.replace(/\s+/g, ' ')); t.split(/(?<=[.!?:])\s+/).forEach(s => uniq.add(s)); } }
  }
  await p.evaluate(() => { document.querySelectorAll('details').forEach(d => { d.open = true; }); });
  (await p.evaluate(() => document.querySelector('main').textContent.replace(/\s+/g, ' '))).split(/(?<=[.!?:])\s+/).forEach(s => uniq.add(s));
  await p.evaluate(() => { document.querySelectorAll('details').forEach(d => { d.open = false; }); scrollTo(0, 0); });
  await p.screenshot({ path: `${out}/full-${name}.png`, fullPage: true });
  res[name] = { docHeight: m.docHeight, scenes: m.scenes, sceneHeights: m.sceneHeights, calcTop: m.calcTop, priceTop: m.priceTop, largestModules: m.largestModules, defaultVisibleWords: words(m.visibleText), defaultVisibleProseWords: words(m.proseText), uniqueCopyWordsIncludingOptional: words([...uniq].join(' ')), zeroClick: m.zeroClick };
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(res, null, 1));
