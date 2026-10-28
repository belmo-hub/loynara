/**
 * ENG-123 acceptance 1 and 10, checked against Stripe TEST MODE only (never a live key): a subscription started the way
 * startBilling starts it (no payment method, no trial, first billing date = the same date next month, proration off) must
 * issue NO invoice during the free month, then exactly one numbered month-two invoice for the plan's price; a start on the
 * 31st must bill on the shorter month's last day and then return to the 31st. Uses test clocks and deletes them afterwards.
 *
 *   STRIPE_SECRET_KEY=sk_test_… STRIPE_PRICE_LIST=price_… npx tsx scripts/stripe-free-month-check.ts
 */
import { expectedFreeUntil } from "../src/lib/stripe-config";

const key = process.env.STRIPE_SECRET_KEY ?? "";
const price = process.env.STRIPE_PRICE_LIST ?? "";
// Only a test-mode secret key; the key itself is never printed (only Stripe ids and amounts are).
if (!key.startsWith("sk_test_")) throw new Error("Refused: this check runs only with a Stripe test-mode secret key (sk_test_)");
if (!/^price_/.test(price)) throw new Error("Set STRIPE_PRICE_LIST to the test-mode 49,00 € monthly price");

type Json = Record<string, unknown> & { id: string };
async function stripe(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string> = {}): Promise<Json> {
  const form = new URLSearchParams(params).toString();
  const response = await fetch(`https://api.stripe.com/v1${path}${method === "GET" && form ? `?${form}` : ""}`, {
    method, headers: { Authorization: `Bearer ${key}`, "Stripe-Version": "2025-03-31.basil", "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "POST" ? form : undefined,
  });
  const json = await response.json() as Json & { error?: { message?: string } };
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${json.error?.message ?? ""}`);
  return json;
}
const seconds = (at: Date) => Math.floor(at.getTime() / 1000);
const iso = (unix: number) => new Date(unix * 1000).toISOString();

async function advance(clock: string, to: Date) {
  await stripe("POST", `/test_helpers/test_clocks/${clock}/advance`, { frozen_time: String(seconds(to)) });
  for (let i = 0; i < 60; i++) {
    if ((await stripe("GET", `/test_helpers/test_clocks/${clock}`)).status === "ready") return;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error("Test clock did not finish advancing");
}
const invoices = async (subscription: string) => ((await stripe("GET", "/invoices", { subscription, limit: "10" })).data as Array<{ number: string | null; amount_due: number; status: string; period_start: number; period_end: number }>);

async function scenario(name: string, start: Date, checkpoints: Date[], anchor: "config" | "exactly-one-month" = "config") {
  const clock = await stripe("POST", "/test_helpers/test_clocks", { frozen_time: String(seconds(start)), name: `ENG-123 ${name}` });
  const findings: string[] = [];
  try {
    const customer = await stripe("POST", "/customers", { test_clock: clock.id, name: `ENG-123 ${name}` });
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(start).slice(8);
    // "config" is what startBilling sends; "exactly-one-month" probes the edge: an explicit anchor at the creation time plus one month.
    const oneMonth = new Date(start); oneMonth.setUTCMonth(oneMonth.getUTCMonth() + 1);
    const anchorParams: Record<string, string> = anchor === "config"
      ? { "billing_cycle_anchor_config[day_of_month]": String(Number(day)), "billing_cycle_anchor_config[hour]": "0", "billing_cycle_anchor_config[minute]": "0", "billing_cycle_anchor_config[second]": "0" }
      : { billing_cycle_anchor: String(seconds(oneMonth)) };
    const sub = await stripe("POST", "/subscriptions", {
      customer: customer.id, "items[0][price]": price, "items[0][quantity]": "1", ...anchorParams, proration_behavior: "none",
      collection_method: "charge_automatically", "payment_settings[save_default_payment_method]": "on_subscription",
    });
    const expected = anchor === "config" ? seconds(expectedFreeUntil(start)) : seconds(oneMonth);
    findings.push(`subscription ${sub.id}, status at start: ${sub.status}; first billing date ${iso(sub.billing_cycle_anchor as number)} (expected ${iso(expected)}) ${sub.billing_cycle_anchor === expected ? "OK" : "MISMATCH"}`);
    const atStart = await invoices(sub.id);
    findings.push(`invoices during the free month: ${atStart.length} ${atStart.length === 0 ? "OK (no 0,00 € invoice)" : `NOT OK: ${JSON.stringify(atStart.map(i => ({ number: i.number, amount: i.amount_due })))}`}`);
    for (const checkpoint of checkpoints) {
      await advance(clock.id, checkpoint);
      const list = await invoices(sub.id);
      findings.push(`at ${checkpoint.toISOString()}: ${list.length} invoice(s): ${list.map(i => `${i.number ?? "unnumbered"} ${i.amount_due / 100} € ${i.status} ${iso(i.period_start)}→${iso(i.period_end)}`).join("; ")}`);
    }
  } finally {
    await stripe("DELETE", `/test_helpers/test_clocks/${clock.id}`);
  }
  console.log(`\n${name}\n  ${findings.join("\n  ")}`);
}

async function main() {
  // Go-live at 10:00 Berlin on 28 Oct and on 31 Jan; check just after month two starts, and for the 31st also the month after.
  await scenario("start on the 28th", new Date("2026-10-28T09:00:00Z"), [new Date("2026-11-28T01:00:00Z")]);
  await scenario("start on the 31st", new Date("2027-01-31T09:00:00Z"), [new Date("2027-02-28T01:00:00Z"), new Date("2027-03-31T01:00:00Z")]);
  // Edge: the anchor exactly one month after creation. Stripe may treat that as an immediate first full period (an invoice now); startBilling avoids it by anchoring at 00:00 UTC.
  await scenario("anchor exactly one month after creation", new Date("2026-10-28T09:00:00Z"), [new Date("2026-11-28T10:00:00Z")], "exactly-one-month");
  console.log("\nExpected: no invoice during the free month; one invoice at month two for the plan's price with the next number in the account-wide series; for the 31st, bills on 28 Feb, then on 31 Mar. The exact-one-month edge is informative: if it shows an invoice at creation, keep startBilling's 00:00 UTC anchor.");
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
