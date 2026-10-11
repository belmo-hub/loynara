// Recomputes the funnel from the input rows of funnel-model.csv, so the spreadsheet and this script never disagree.
// Usage: node gtm/data/funnel.mjs [--actuals pipeline.csv]   (edit the CSV inputs, rerun)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCsv } from './csv.mjs';

const dir = import.meta.dirname;
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


// Month one (month-one-model.csv): what each operating model yields at its assumptions, and what reaching the goal would require.
export function monthOne(a) {
  const k = a.rate_demo_to_close * a.close_rate_factor * a.rate_close_to_activated, m = 1 + a.referral_intros_per_activated_merchant * a.rate_referral_intro_to_activated;
  const doors = a.weeks_in_month * a.field_days_per_week * a.sellers * a.doors_per_seller_day, conv = doors * a.rate_door_to_conversation;
  const demosField = conv * a.rate_conversation_to_demo, demosIn = a.weeks_in_month * a.inbound_leads_per_week * a.rate_inbound_lead_to_demo, demos = demosField + demosIn;
  const merchantsNeeded = a.goal_paying_locations / a.locations_per_merchant, fieldDemosNeeded = merchantsNeeded / (k * m) - demosIn;
  const r2 = x => Math.round(x * 100) / 100;
  return {
    doors, demos: r1(demos), activated: r1(demos * k * m), payingLocations: r1(demos * k * m * a.locations_per_merchant),
    requiredDoors: up(fieldDemosNeeded / (a.rate_door_to_conversation * a.rate_conversation_to_demo)),
    requiredDoorsPerSellerDay: r1(up(fieldDemosNeeded / (a.rate_door_to_conversation * a.rate_conversation_to_demo)) / (a.weeks_in_month * a.field_days_per_week * a.sellers)),
    requiredDemoRate: r2(fieldDemosNeeded / conv),
    requiredCloseRate: r2(merchantsNeeded / (demos * a.close_rate_factor * a.rate_close_to_activated * m)),
    requiredActivationRate: r2(merchantsNeeded / (demos * a.rate_demo_to_close * a.close_rate_factor * m)),
  };
}

const out = Object.fromEntries(scenarios.map(s => [s, plan(input[s])]));
console.table(out);

if (process.argv.includes('--month-one')) {
  const [head, ...lines] = parseCsv(readFileSync(resolve(dir, 'month-one-model.csv'), 'utf8'));
  const cols = head.slice(2, -2), inputs = Object.fromEntries(cols.map(c => [c, {}]));
  for (const l of lines) if (l[head.length - 2] === 'input') cols.forEach((c, i) => (inputs[c][l[1]] = Number(l[2 + i])));
  console.table(Object.fromEntries(cols.map(c => [c, monthOne(inputs[c])])));
}

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
