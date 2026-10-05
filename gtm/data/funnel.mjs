// Recomputes the funnel from the input rows of funnel-model.csv, so the spreadsheet and this script never disagree.
// Usage: node gtm/data/funnel.mjs [--actuals pipeline.csv]   (edit the CSV inputs, rerun)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = import.meta.dirname;
// Minimal RFC 4180 reader: quoted fields may contain commas, quotes ("") and newlines.
export function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v !== ''));
}

const rows = parseCsv(readFileSync(resolve(dir, 'funnel-model.csv'), 'utf8')).slice(1);
const scenarios = ['conservative', 'target', 'stretch'];
const input = Object.fromEntries(scenarios.map(s => [s, {}]));
for (const [, metric, c, t, s, type] of rows) if (type === 'input') [c, t, s].forEach((v, i) => (input[scenarios[i]][metric] = Number(v)));

const up = Math.ceil, r1 = x => Math.round(x * 10) / 10;
export function plan(a) {
  const merchants = up(a.goal_paying_locations / a.locations_per_paying_merchant);
  const fromWalkins = up(merchants * (1 - a.share_of_merchants_from_referrals));
  const pilots = up(fromWalkins / a.rate_pilot_to_paid);
  const demos = up(pilots / a.rate_demo_to_pilot);
  const conversations = up(demos / a.rate_conversation_to_demo);
  const doors = up(conversations / a.rate_door_to_owner_conversation);
  const weeks = up(doors / (a.doors_per_field_day * a.field_days_per_week));
  return { merchants, fromWalkins, pilots, demos, conversations, doors, weeks, demosPerWeek: r1(demos / weeks), setupsPerWeek: r1(pilots / weeks) };
}

const out = Object.fromEntries(scenarios.map(s => [s, plan(input[s])]));
console.table(out);

// Optional: compare real pipeline rates against the target thresholds in 04-funnel.md.
const i = process.argv.indexOf('--actuals');
if (i > 0) {
  const [cols, ...lines] = parseCsv(readFileSync(resolve(process.argv[i + 1]), 'utf8'));
  const recs = lines.map(l => Object.fromEntries(l.map((v, j) => [cols[j], v])));
  const count = stage => recs.filter(r => r[stage] && r[stage] !== '').length;
  const doors = recs.length, conv = count('owner_conversation_date'), demo = count('demo_date'), pilot = count('pilot_live_date'), paid = count('paid_date');
  const stage = (hit, sample, floor, judgeAfter) => ({
    actual: sample ? `${Math.round((100 * hit) / sample)} %` : 'n/a', floor: `${floor * 100} %`, sample, judgeAfter,
    verdict: sample < judgeAfter ? 'too early' : hit / sample < floor ? 'BELOW FLOOR – see 04-funnel.md' : 'ok',
  });
  console.table({
    'door → conversation': stage(conv, doors, 0.3, 60),
    'conversation → demo': stage(demo, conv, 0.35, 40),
    'demo → pilot': stage(pilot, demo, 0.2, 25),
    'pilot → paid': stage(paid, pilot, 0.6, 10),
  });
}
