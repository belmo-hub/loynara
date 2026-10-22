import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { RELEASED_GATES, GATES, COPY_VARIANTS } from '../src/claims.js';

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
  assert.deepEqual(RELEASED_GATES, { nfcAccepted: true, rcDeployed: true });
  assert.deepEqual(GATES, RELEASED_GATES, 'tests run without a gate override');
});

test('pre-gate copy: NFC only as prepared outlook, no RC-only capability claimed', () => {
  const text = all(render(''));
  for (const m of text.match(/[^.?]*(?:NFC|Antippen|antippen)[^.?]*[.?]/g) ?? []) assert.match(m, /Ausblick|vorbereitet|\?$/, m);
  assert.doesNotMatch(text, /Kartennummer|neu aus|gleicher Verlauf/);
  assert.match(text, /Per QR-Code/);
});

test('post-NFC copy: NFC is primary and QR stays the fallback; Wallet stays outlook', () => {
  const text = all(render('nfcAccepted'));
  assert.match(text, /Antippen oder QR-Code/);
  assert.match(text, /QR-Code (?:bleibt immer als Alternative|scannen)/);
  assert.doesNotMatch(text, /NFC[^.]*Ausblick/, 'NFC is no longer outlook after acceptance');
  for (const m of text.match(/[^.?]*Wallet[^.?]*[.?]/g) ?? []) assert.match(m, /Ausblick|\?$/, m);
});

test('post-RC copy: lost link means reissue with the same balance, history and card number; old access stops', () => {
  const home = visible(render('rcDeployed').home);
  assert.match(home, /stellst du oder deine Leitung die Karte neu aus: gleicher Stand, gleicher Verlauf, gleiche Kartennummer und gleiche Mitgliedschaft\. Der alte Link und der alte QR-Code der Karte funktionieren danach nicht mehr\./);
  assert.match(home, /findet dein Team die Karte über ihre kurze Kartennummer/);
  assert.match(home, /Per QR-Code/, 'the RC gate alone does not switch the entry claim');
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
    assert.match(text, /alte Link und der alte QR-Code[^.]*nicht mehr/);
    assert.doesNotMatch(text, /kommt mit dem nächsten Update|mit dem nächsten Update|comes with the next update/i);
    assert.doesNotMatch(html, /href="[^"\s]*\.invalid[^"\s]*"|href="[^"\s]*(?:sign-up|signup|register|checkout)[^"\s]*"/i);
  }
});
