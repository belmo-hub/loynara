// Lab measurements only (local loopback, Chromium, 4x CPU throttle). Not field data and not a Core Web Vitals pass at the 75th percentile.
import { chromium } from '@playwright/test';
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
const base = process.env.BASE ?? 'http://127.0.0.1:8765';
const root = resolve(import.meta.dirname, 'site');
const size = f => { const b = readFileSync(resolve(root, f)); return { raw: b.length, gzip: gzipSync(b).length }; };
console.log('ASSETS', JSON.stringify({ 'app.js': size('assets/app.js'), 'styles.css': size('styles.css'), 'index.html': size('index.html'), fonts: ['manrope-latin'].map(n => statSync(resolve(root, `assets/fonts/${n}.woff2`)).size) }));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const [label, viewport, mobile] of [['mobile 390x844', { width: 390, height: 844 }, true], ['desktop 1440x900', { width: 1440, height: 900 }, false]]) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.addInitScript(() => {
    window.__m = { lcp: 0, cls: 0, tbt: 0, events: [] };
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__m.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__m.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__m.tbt += Math.max(0, e.duration - 50); }).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__m.events.push([e.name, Math.round(e.duration)]); }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  });
  await page.goto(base + '/', { waitUntil: 'load' }); await page.waitForTimeout(1500);
  const load = await page.evaluate(() => ({ lcp: Math.round(window.__m.lcp), cls: +window.__m.cls.toFixed(4), tbt: Math.round(window.__m.tbt) }));
  // scroll through the page, run the demo, drag a calculator slider and type in a field
  const H = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < H; y += 500) { await page.evaluate(v => scrollTo(0, v), y); await page.waitForTimeout(60); }
  await page.locator('#ablauf').scrollIntoViewIfNeeded();
  await page.locator('[data-act="visit"]').click(); await page.waitForTimeout(300); await page.locator('[data-act="visit"]').click(); await page.waitForTimeout(300); await page.locator('#empfehlung').scrollIntoViewIfNeeded(); await page.locator('[data-act="ref"]').click(); await page.waitForTimeout(300);
  await page.locator('#rechner').scrollIntoViewIfNeeded();
  const r = page.locator('[data-range="gain"]'); const box = await r.boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2); await page.mouse.down();
  for (let i = 0; i <= 30; i++) { await page.mouse.move(box.x + box.width * (0.3 + 0.4 * i / 30), box.y + box.height / 2); await page.waitForTimeout(16); }
  await page.mouse.up(); await page.waitForTimeout(500);
  await page.locator('[data-in="basket"]').click(); await page.keyboard.type('12,5', { delay: 30 }); await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ cls: +window.__m.cls.toFixed(4), tbt: Math.round(window.__m.tbt), worstEvent: Math.max(0, ...window.__m.events.map(e => e[1])), events: window.__m.events.length }));
  console.log(label, JSON.stringify({ load, afterInteractions: after }));
  await ctx.close();
}
await browser.close();
