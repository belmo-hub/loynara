import { chromium } from '@playwright/test';
const out = 'marketing-site/evidence/corr/';
const b = await chromium.launch({ channel: 'chrome' });
const errs = [];
async function page(w, h) { const c = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 600, isMobile: w < 600 }); const p = await c.newPage(); p.on('console', m => { if (['error', 'warning'].includes(m.type())) errs.push(m.text()); }); p.on('pageerror', e => errs.push(e.message)); await p.goto('http://127.0.0.1:8790/'); await p.waitForTimeout(900); return p; }
const jump = (p, sel, block = 'start') => p.evaluate(([s, bl]) => document.querySelector(s).scrollIntoView({ behavior: 'instant', block: bl }), [sel, block]);
// desktop
let p = await page(1440, 900);
await p.screenshot({ path: out + 'hero-1440.png' });
await jump(p, '#ablauf'); await p.waitForTimeout(500); await p.screenshot({ path: out + 'demo-start-1440.png' });
await p.locator('[data-action="open-nfc"]').click(); await p.waitForTimeout(500); await p.locator('[data-action="confirm"]').click(); await p.waitForTimeout(600); await p.screenshot({ path: out + 'demo-confirmed-1440.png' });
await p.locator('[data-action="nextVisit"]').click(); await p.waitForTimeout(400); await p.locator('[data-action="confirm"]').click(); await p.waitForTimeout(400); await p.locator('[data-action="redeem"]').click(); await p.waitForTimeout(600); await p.screenshot({ path: out + 'demo-redeemed-1440.png' });
await p.locator('#demo-reset').click(); await p.locator('[data-action="identity-new"]').click(); await p.waitForTimeout(300); await p.screenshot({ path: out + 'new-start-1440.png' });
await p.locator('[data-action="open-qr"]').click(); await p.waitForTimeout(400); await p.locator('[data-action="enroll"]').click(); await p.waitForTimeout(400); await p.screenshot({ path: out + 'new-enrolled-1440.png' });
await p.locator('[data-action="confirm"]').click(); await p.waitForTimeout(600); await p.screenshot({ path: out + 'new-confirmed-1440.png' });
await jump(p, '#momente'); await p.waitForTimeout(500);
for (const id of ['quiet', 'missing', 'near']) { await p.locator(`[data-moment="${id}"]`).click(); await p.waitForTimeout(350); await p.locator('#moment-action').click(); await p.waitForTimeout(500); await p.locator('#moment-stage').screenshot({ path: out + `moment-${id}-1440.png` }); }
await jump(p, '#rechner'); await p.waitForTimeout(500); await p.screenshot({ path: out + 'calc-1440-a.png' });
await p.evaluate(() => scrollBy(0, 700)); await p.waitForTimeout(400); await p.screenshot({ path: out + 'calc-1440-b.png' });
const hb = await p.locator('#chart-hit').boundingBox(); await p.mouse.move(hb.x + hb.width * 0.55, hb.y + 40); await p.waitForTimeout(250); await p.locator('.calc-graph').screenshot({ path: out + 'calc-inspect-1440.png' });
await p.locator('#in-gain').fill('0'); await p.waitForTimeout(400); await p.mouse.move(5, 5); await p.waitForTimeout(250); await p.locator('.calc-graph').screenshot({ path: out + 'calc-zero-1440.png' });
await p.locator('#calc-reset').click();
await p.locator('.calc-assumptions summary').click(); await p.waitForTimeout(300); await p.locator('#calc-primary').screenshot({ path: out + 'calc-details-1440.png' });
await jump(p, '#plattform'); await p.waitForTimeout(500); await p.screenshot({ path: out + 'platform-1440.png' });
await jump(p, '#start'); await p.waitForTimeout(500); await p.screenshot({ path: out + 'setup-1440.png' });
await jump(p, '#preis'); await p.waitForTimeout(500); await p.screenshot({ path: out + 'pricing-1440.png' });
await jump(p, '#anfrage'); await p.waitForTimeout(500); await p.screenshot({ path: out + 'contact-1440.png' });
console.log('errors', errs);
await b.close();
