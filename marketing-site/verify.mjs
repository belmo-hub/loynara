import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const root = resolve(import.meta.dirname, 'site');
const walk = dir => readdirSync(dir).flatMap(n => statSync(resolve(dir, n)).isDirectory() ? walk(resolve(dir, n)) : [resolve(dir, n)]);
const pages = walk(root).filter(f => f.endsWith('.html'));
const blockers = [];
let links = 0;
for (const page of pages) {
  const html = readFileSync(page, 'utf8'), rel = page.slice(root.length);
  assert.ok(html.includes('<html lang="de" dir="ltr">'), `language: ${rel}`);
  assert.match(html, /rel="canonical" href="https:\/\/getloynara\.com\//, `canonical: ${rel}`);
  assert.doesNotMatch(html, /LoopLocal|looplocal|localhost|preview\.getloynara\.com|getlyonara|loynara-audit\.pages\.dev|card_[A-Za-z0-9_-]{10,}|password/i, `private/old content: ${rel}`);
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    links++;
    if (/^mailto:/.test(url)) { assert.match(url, /^mailto:support@getloynara\.com(\?|$)/, `unexpected mail target ${url}`); continue; }
    if (/^https:/.test(url)) { assert.ok(/^https:\/\/(getloynara\.com|app\.getloynara\.com)(\/|$)/.test(url) || (rel === '/datenschutz/index.html' && url === 'https://www.cloudflare.com/privacypolicy/'), `unexpected external ${url} in ${rel}`); continue; }
    assert.ok(!/^(http:|javascript:|#$)/.test(url), `bad link ${url} in ${rel}`);
    const [path, hash] = url.split('#');
    let target = path ? resolve(root, '.' + path) : page;
    if (existsSync(target) && statSync(target).isDirectory()) target = resolve(target, 'index.html');
    assert.ok(existsSync(target), `Missing link ${url} in ${rel}`);
    if (hash) assert.ok(target === page ? ids.has(hash) : readFileSync(target, 'utf8').includes(`id="${hash}"`), `Missing anchor ${url} in ${rel}`);
  }
  if (html.includes('data-legal-placeholder')) blockers.push(`${rel} holds a legal placeholder (operator-approved text missing)`);
}
for (const file of walk(resolve(root, 'assets')).filter(f => f.endsWith('.js'))) {
  const js = readFileSync(file, 'utf8');
  assert.doesNotMatch(js, /\bfetch\(|sendBeacon|XMLHttpRequest|WebSocket|localStorage|sessionStorage|document\.cookie|console\.log|eval\(|new Function/, `${file}: no outbound or persistent data API`);
  assert.doesNotMatch(js, /https?:\/\/(?!getloynara\.com|app\.getloynara\.com|www\.w3\.org|motion\.dev|github\.com|developer\.mozilla\.org)/, `${file}: unexpected URL`);
  for (const [, p] of js.matchAll(/from\s*['"](\.[^'"]+)['"]/g)) assert.ok(existsSync(resolve(dirname(file), p)), `${file}: import ${p}`);
}
const headers = readFileSync(resolve(root, '_headers'), 'utf8');
assert.match(headers, /script-src 'self'/); assert.match(headers, /connect-src 'none'/); assert.match(headers, /form-action 'none'/); assert.doesNotMatch(headers, /unsafe-inline|unsafe-eval/);
const robots = readFileSync(resolve(root, 'robots.txt'), 'utf8'); assert.match(robots, /Sitemap: https:\/\/getloynara\.com\/sitemap\.xml/); assert.doesNotMatch(robots, /Disallow: \//);
for (const asset of ['assets/loynara-mark.svg', 'assets/social-preview.png', 'assets/app.js', 'assets/fonts/manrope-latin.woff2', 'assets/fonts/Manrope-OFL.txt', 'styles.css']) assert.ok(existsSync(resolve(root, asset)), asset);
console.log(`PASS: ${pages.length} pages, ${links} links/anchors/assets, metadata, private-output and browser data-flow checks.`);
for (const b of blockers) console.log(`PUBLICATION BLOCKER: ${b}`);

if (process.env.MARKETING_PUBLIC === 'true') {
  assert.equal(blockers.length, 0, 'Public verification requires legal content');
  for (const page of pages) assert.doesNotMatch(readFileSync(page, 'utf8'), /data-legal-placeholder|Entwurf|Teilnahmebedingungen|teilnahmebedingungen|39\s*€|€\s*39/i, 'No draft legal or retired offer in public output');
}
