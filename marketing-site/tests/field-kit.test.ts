import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseCsv } from '../../gtm/data/csv.mjs';

const field = resolve(import.meta.dirname, '../../gtm/field');
const read = (p: string) => readFileSync(resolve(field, p), 'utf8');
const rows = (() => { const [h, ...r] = parseCsv(read('prospects.csv')) as string[][]; return r.map(x => Object.fromEntries(h.map((k, i) => [k, x[i] ?? '']))); })();
const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

test('prospects: 60 unique rows, 22 barbers and 38 pizzerias/Imbiss, routed 20/20/20, every row sourced', () => {
  assert.equal(rows.length, 60);
  assert.equal(new Set(rows.map(r => r.merchant_id)).size, 60);
  assert.equal(rows.filter(r => r.category === 'Barber').length, 22);
  assert.equal(rows.filter(r => r.category !== 'Barber').length, 38);
  for (const g of ['FIRST 20', 'NEXT 20', 'FINAL 20']) assert.equal(rows.filter(r => r.route_group === g).length, 20, g);
  for (const r of rows) {
    assert.match(r.priority, /^[ABC]$/, r.merchant_id); assert.match(r.data_confidence, /^[ABC]$/, r.merchant_id);
    assert.ok(r.sources.startsWith('http'), `${r.merchant_id} has a source`); assert.ok(r.opening_hours && r.street && r.neighborhood, r.merchant_id);
    assert.match(r.retrieved_on, /^2026-10-05$/); assert.ok(r.maps_url.startsWith('https://www.google.com/maps/search/'), r.merchant_id);
    assert.match(r.paper_stamp_card_evidence, /Not evidenced online/); // no claim of paper-card evidence that cannot be seen online
  }
});

test('prospects: no personal data and no invented proof (no owner names, no mobile numbers unless the business publishes them, Instagram only with a stated basis)', () => {
  const header = Object.keys(rows[0]);
  for (const bad of ['owner_name', 'email', 'public_business_email', 'contact_name']) assert.ok(!header.includes(bad), bad);
  for (const r of rows) {
    if (/^(?:\+49 ?1|01[567])/.test(r.public_phone)) assert.match(r.public_phone, /published on the shop's own website/, r.merchant_id);
    if (r.instagram) assert.match(r.instagram, /\((?:site|search hit|embedded on site)|not checked|exists/, r.merchant_id);
    assert.doesNotMatch(r.loyalty_programme_public + r.digital_loyalty_evidence, /Stempelkarte vorhanden|hat eine Stempelkarte/i, r.merchant_id);
  }
  assert.ok(rows.every(r => !/zentral|franchise/i.test(r.owner_operated_likely)), 'owner flag is a short enum');
});

const variants = (flags: string[]) => JSON.parse(execFileSync('python3', ['-c', `import variants,json;print(json.dumps(variants.variant(${flags.includes('nfc') ? 'nfc=True' : ''}${flags.length === 2 ? ',' : ''}${flags.includes('rc') ? 'rc=True' : ''})))`], { cwd: resolve(field, 'collateral') }).toString());
const build = (flags: string[]) => { const v = variants(flags); const out: Record<string, string> = {}; for (const f of readdirSync(resolve(field, 'collateral/templates')).filter(x => x.endsWith('.html'))) out[f] = read(`collateral/templates/${f}`).replace(/\{\{(\w+)\}\}/g, (_, k) => { assert.ok(k in v, `${f} uses ${k}`); return v[k]; }); return out; };

test('collateral (today): claim-safe German, price from the single source, NFC and RC items only in their allowed wording', () => {
  const docs = build([]);
  assert.deepEqual(Object.keys(docs).sort(), ['after-demo-summary.html', 'demo-cheat-sheet.html', 'objection-sheet.html', 'pilot-interest-sheet.html']);
  const BANNED = /garantiert|Testimonial|Referenzkunde|\d+\s?% mehr|nur noch|kostenlos|gratis|mehr Umsatz/i;
  for (const [f, html] of Object.entries(docs)) {
    const t = visible(html.replace(/<span class="code">[^<]*<\/span>/g, ' ')).replace(/Stand: [^.]*?Abnahme/g, ' ');   // objection codes and the release-state label are internal, not customer copy           // internal release-state label, not customer copy
    if (f === 'after-demo-summary.html') assert.doesNotMatch(t, BANNED, `${f} (merchant-facing)`);
    for (const m of t.match(/[^.?!]*(?:NFC|antipp)[^.?!]*[.?!]/gi) ?? []) assert.match(m, /vorbereitet|Ausblick|NFC nicht geht|nicht geht|\?$|Nie|nie sagen|als vorhanden|als live/i, `${f}: ${m}`);
    for (const m of t.match(/[^.?!]*(?:Wallet|Nachrichten|Logo)[^.?!]*[.?!]/g) ?? []) assert.match(m, /Ausblick|nicht Teil|Nie|nie|als vorhanden|als live|noch nicht|nicht dabei|schickt Loynara nichts|zeigen wir/, `${f}: ${m}`);
  }
  const obj = visible(docs['objection-sheet.html']);
  for (const o of ['Ich habe schon Stempelkarten', 'Meine Kunden laden keine App runter', 'Meine Mitarbeiter machen das nicht', 'Das dauert an der Kasse zu lange', 'Ich kenne meine Stammkunden', 'Ich habe Instagram', '49 € ist zu teuer', 'Was, wenn ein Mitarbeiter einen Fehler macht', 'Was, wenn der Kunde seine Karte verliert', 'Was, wenn NFC nicht geht', 'Ich muss darüber nachdenken']) assert.ok(obj.includes(o), o);
  assert.match(obj, /kommt mit dem nächsten Update/, 'RC items are phrased as upcoming');
  const demo = visible(docs['demo-cheat-sheet.html']);
  for (const b of ['1 Kunde', '2 Tresen', '3 Fortschritt', '4 Empfehlung', '5 Inhaber', '6 Preis', '7 Frage', '20-Sekunden-Pitch', '2-Minuten-Pitch', '5-Minuten-Demo', 'Abschlussfrage']) assert.ok(demo.includes(b), b);
  assert.match(visible(docs['pilot-interest-sheet.html']), /Kein Vertrag, keine Zahlungszusage, kein Startdatum/);
  const after = docs['after-demo-summary.html'];
  assert.doesNotMatch(after, /https?:\/\/(?!www\.w3\.org)/, 'no links in the after-demo template');
  assert.ok(/\[Laden\]/.test(after) && /\[Vorname\]/.test(after));
});

test('collateral after the gates: reissue/correction and tap wording switch together, QR stays the alternative', () => {
  const docs = build(['nfc', 'rc']);
  const obj = visible(docs['objection-sheet.html']);
  assert.match(obj, /stellt die Karte neu aus: gleicher Stand, gleicher Verlauf, gleiche Kartennummer/);
  assert.match(obj, /Der alte Link und der alte QR-Code der Karte funktionieren danach nicht mehr/);
  assert.match(obj, /korrigiert mit Begründung/);
  assert.match(obj, /scannt der Kunde den QR-Code\. Der bleibt immer die Alternative/);
});

test('stand artwork: pre-NFC never advertises NFC, post-NFC says antippen with QR fallback, QR payload cannot resolve, QA passes', () => {
  const svgText = (f: string) => [...read(`stand/svg/${f}`).matchAll(/>([^<>]+)<\/text>/g)].map(m => m[1]).join(' ');
  const pre = svgText('insert-pre-nfc.svg'), post = svgText('insert-post-nfc.svg');
  assert.doesNotMatch(pre, /NFC|antipp|Wallet/i); assert.match(pre, /Für deine Kundenkarte QR-Code scannen|Für deine Kundenkarte\s+QR-Code scannen/);
  assert.match(post, /Handy kurz antippen/); assert.match(post, /oder QR-Code scannen/);
  for (const t of [pre, post]) { assert.match(t, /Platzhalter-QR/); assert.match(t, /Beispiel-Gestaltung/); }
  assert.match(read('stand/artwork.py'), /loynara\.invalid/);
  assert.doesNotMatch(read('stand/svg/insert-pre-nfc.svg') + read('stand/svg/insert-post-nfc.svg'), /getloynara\.com\/|app\.getloynara/);
  assert.ok(existsSync(resolve(field, 'stand/pdf/HOLD_insert-post-nfc_print-bleed.pdf')), 'the post-NFC print file is marked HOLD');
  assert.ok(!existsSync(resolve(field, 'stand/pdf/insert-post-nfc_print-bleed.pdf')), 'there is no un-held post-NFC print file');
  const qa = read('stand/qa-report.md'); assert.doesNotMatch(qa, /\*\*FAIL\*\*/); assert.match(qa, /\*\*(\d+) \/ \1 pass\.\*\*/);
});
