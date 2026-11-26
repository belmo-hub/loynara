import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { RELEASED_GATES, GATES, COPY_VARIANTS } from '../src/claims.js';
import { SITE } from '../src/site.js';

const here = import.meta.dirname;
const visible = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
/** Renders the home page and the supporting pages in a fresh process with the given test gates. */
function render(gates: string): { home: string; pages: string[] } {
  const code = `import { homePage, subPage } from ${JSON.stringify(resolve(here, '../template.ts'))}; import { SUB_PAGES } from ${JSON.stringify(resolve(here, '../src/pages.ts'))};
process.stdout.write(JSON.stringify({ home: homePage(), pages: SUB_PAGES.map(p => subPage(p)) }));`;
  const out = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { env: { ...process.env, LOYNARA_TEST_GATES: gates }, cwd: resolve(here, '../..'), maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.toString());
}
const all = (r: { home: string; pages: string[] }) => [r.home, ...r.pages].map(visible).join(' ');

test('released gates: the NFC tap is primary with QR as the fallback, and the verified production RC capabilities are live', () => {
  assert.deepEqual(RELEASED_GATES, { nfcAccepted: true, rcDeployed: true, bookingLive: false });
  assert.deepEqual(GATES, RELEASED_GATES, 'tests run without a gate override');
});

// The home page is written for the released gates (the sign tap is its hero), so it has one version; the supporting pages keep both.
const pagesOnly = (r: { pages: string[] }) => r.pages.map(visible).join(' ');

test('pre-gate copy on the supporting pages: NFC only as prepared outlook, no RC-only capability claimed', () => {
  const text = pagesOnly(render(''));
  for (const m of text.match(/[^.?]*(?:NFC|Antippen|antippen)[^.?]*[.?]/g) ?? []) assert.match(m, /Ausblick|vorbereitet|\?$/, m);
  assert.doesNotMatch(text, /Kartennummer|neu aus|gleicher Verlauf/);
  assert.match(text, /Per QR-Code/);
});

test('post-NFC copy: NFC is primary and QR stays the fallback; Apple Wallet on request, never Google Wallet', () => {
  const text = all(render('nfcAccepted'));
  assert.match(text, /Antippen oder QR-Code/);
  assert.match(text, /QR-Code (?:bleibt immer als Alternative|scannen)/);
  assert.doesNotMatch(text, /NFC[^.]*Ausblick/, 'NFC is no longer outlook after acceptance');
  for (const m of text.match(/[^.?]*Wallet[^.?]*[.?]/g) ?? []) assert.match(m, /Ausblick|auf Wunsch|\?$/, m);
  assert.doesNotMatch(text, /Google Wallet/);
});

test('post-RC copy: lost link means reissue with the same balance, history and card number; old access stops', () => {
  const rendered = render('rcDeployed');
  for (const text of [visible(rendered.home), pagesOnly(rendered)]) {
    assert.match(text, /stellst du oder deine Leitung die Karte neu aus: gleicher Stand, gleicher Verlauf, gleiche Kartennummer und gleiche Mitgliedschaft\. In beiden Fällen funktionieren der alte Link, der alte QR-Code und eine auf Wunsch gespeicherte Apple-Wallet-Karte danach nicht mehr\./);
    assert.match(text, /findet dein Team die Karte über ihre kurze Kartennummer/);
    assert.match(text, /über „Karte wiederfinden“ selbst zurück\. Sonst stellst du oder deine Leitung/, 'self-recovery leads straight into the reissue; the closing sentence covers both');
  }
  assert.match(pagesOnly(rendered), /Per QR-Code/, 'the RC gate alone does not switch the entry claim');
});

test('every gated pair exists in both versions and no version promises the unbuilt', () => {
  for (const group of Object.values(COPY_VARIANTS)) {
    const [a, b] = Object.values(group) as Array<Record<string, unknown>>;
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
    for (const v of Object.values(group)) assert.doesNotMatch(JSON.stringify(v), /garantiert|Zu Wallet hinzufügen|automatisch|Kampagne starten|Logo auf der Karte/);
  }
});

test('the build refuses a test gate override', () => {
  assert.throws(() => execFileSync(process.execPath, ['--import', 'tsx', resolve(here, '../build.mts')], { env: { ...process.env, LOYNARA_TEST_GATES: 'nfcAccepted' }, cwd: resolve(here, '../..'), stdio: 'pipe' }), /test-only override/);
});

// Public rendered copy must reflect canonical application c822d2381dc67544a0ba0c898bf2ddcf98035943.
test('public home and industry FAQs explain live lookup, correction and secure membership-preserving reissue', async () => {
  const { homePage, subPage } = await import('../template.js');
  const { barber, pizzeria } = await import('../src/pages.js');
  for (const html of [homePage(), subPage(barber), subPage(pizzeria)]) {
    const text = visible(html);
    assert.match(text, /K-XXXXXX/);
    assert.match(text, /korrigier[^.]*Begründung/);
    assert.match(text, /gleiche Mitgliedschaft/);
    assert.match(text, /alte Link, der alte QR-Code und eine auf Wunsch gespeicherte Apple-Wallet-Karte[^.]*nicht mehr/);
    assert.doesNotMatch(text, /kommt mit dem nächsten Update|mit dem nächsten Update|comes with the next update/i);
    assert.doesNotMatch(html.replaceAll(`href="${SITE.registerUrl}"`, ''), /href="[^"\s]*\.invalid[^"\s]*"|href="[^"\s]*(?:sign-up|signup|register|checkout)[^"\s]*"/i, 'the only sign-up link is the app\'s own');
  }
});

test('booking gate off: no Termin + Treue plan, no Salons link, no salon page', () => {
  const r = render('nfcAccepted,rcDeployed'), t = visible(r.home);
  assert.match(r.home, /<p class="amt">49 €<\/p><p class="per">pro Monat und Standort<\/p>/);
  assert.doesNotMatch(t, /Termin \+ Treue|69 €|Für Salons|Keine Provision, nie/); assert.ok(!r.home.includes('price-pair') && !r.home.includes('/fuer-salons/'));
  assert.equal(r.pages.length, 3); assert.ok(r.pages.every(p => !p.includes('/fuer-salons/')));
});

test('booking gate on: the Termin + Treue plan at 69 € without a money-back promise, the Salons link and the salon page', () => {
  const r = render('nfcAccepted,rcDeployed,bookingLive'), t = visible(r.home);
  assert.match(t, /Termin \+ Treue/); assert.match(t, /Alles aus dem 49‑€‑Paket/); assert.match(r.home, /<p class="amt">69 €<\/p><p class="per">Termin \+ Treue, pro Monat und Standort<\/p>/); assert.match(r.home, /<p class="amt">49 €<\/p><p class="per">Treue, pro Monat und Standort<\/p>/); assert.doesNotMatch(t, /Geld zurück|weniger als 70 €/);
  assert.ok(r.home.includes('href="/fuer-salons/"')); assert.equal(r.pages.length, 4); assert.match(visible(r.pages[1]), /Termine auf der Kundenkarte\. Erinnert per Push\./);
  // Design r2: no outcome promise and no founding price; founder Q-115: the card shows 69 € and names its plan.
  assert.doesNotMatch(visible(r.pages[1]), /Weniger Nichterscheinen|Gründungspreis|Ein Preis pro Standort|49 € \/ Monat \/ Standort/); assert.match(r.pages[1], /<p class="price"><b>69 €<\/b><span>pro Monat und Standort<\/span><\/p><p class="price-note">Termin \+ Treue: Alles aus dem 49‑€‑Paket, dazu Online-Termine\.<\/p>/);
  assert.match(r.pages[1], /<title>Online-Termine ohne Provision für Salons – Loynara<\/title>/); assert.match(r.pages[1], /<meta name="description" content="Termine auf der Kundenkarte, erinnert per Push: keine Provision, kein WhatsApp-Chaos, deine Kunden bleiben deine\.">/);
  assert.match(visible(r.home), /Zwei Pakete pro Standort\./); assert.doesNotMatch(visible(r.pages[1]), /pausiert/);
});

test('booking gate on: the home Termin plan uses the home page\'s own plan classes, which home.css styles', () => {
  const r = render('nfcAccepted,rcDeployed,bookingLive');
  const plan = r.home.slice(r.home.indexOf('<p class="per">Termin + Treue, pro Monat und Standort</p>') - 200);
  assert.match(plan, /<div class="pcard"><p class="amt">69 €<\/p><p class="per">Termin \+ Treue, pro Monat und Standort<\/p>/);
  assert.match(plan, /<a class="btn btn-pri" href="#rq" data-want="demo">Demo anfragen<\/a>/);
  assert.match(plan, /<ul class="incl" aria-label="In Termin \+ Treue enthalten">/);
  assert.ok(!r.home.includes('price-pair') && !r.home.includes('class="price-card"'));
  const css = readFileSync(resolve(here, '../design/home.css'), 'utf8');
  assert.match(css, /\.pcard,\.incl\{[^}]*background:var\(--surface\)/); assert.match(css, /\.btn-pri\{background:var\(--action\)/); assert.match(css, /\.pcard \.amt\{|\.amt\{/);
});

test('the built site carries nothing of Termin while bookingLive is off (Design minor, 22 Nov)', () => {
  if (RELEASED_GATES.bookingLive) return;
  const files: string[] = [];
  const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = resolve(dir, name); if (statSync(path).isDirectory()) walk(path); else if (/\.(html|js|css|xml|txt)$/.test(name)) files.push(path); } };
  walk(resolve(here, '../site'));
  for (const file of files) assert.doesNotMatch(readFileSync(file, 'utf8'), /69\s*€|Geld zurück|fuer-salons|price-pair|Termin \+ Treue/, file);
});
