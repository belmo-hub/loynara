// Renders SVG files to PDF (exact mm page) and PNG. Usage: node render-svg.mjs <in.svg> <out.pdf|-> <out.png|-> <widthMm> <heightMm> [pxPerMm=6]
import { chromium } from '../../../node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const [input, pdf, png, wmm, hmm, ppm = '6'] = process.argv.slice(2);
const w = Number(wmm), h = Number(hmm), k = Number(ppm);
const svg = readFileSync(input, 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${w}mm ${h}mm;margin:0}html,body{margin:0;padding:0;background:#fff}svg{display:block;width:${w}mm;height:${h}mm}</style></head><body>${svg.replace(/<\?xml[^>]*>/, '')}</body></html>`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const px = 96 / 25.4;
const page = await browser.newPage({ viewport: { width: Math.ceil(w * px), height: Math.ceil(h * px) }, deviceScaleFactor: k / px });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
if (pdf !== '-') await page.pdf({ path: pdf, width: `${w}mm`, height: `${h}mm`, printBackground: true, pageRanges: '1' });
if (png !== '-') await page.screenshot({ path: png, clip: { x: 0, y: 0, width: w * px, height: h * px } });
await browser.close();
