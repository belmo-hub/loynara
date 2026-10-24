import { isProductionDeployment } from "./pilot-policy";

/**
 * Stripe billing configuration (ENG-055). Kept free of database imports so the production gate (scripts/config-check.ts)
 * can use it. Prices live in Stripe; the env names which price is which plan. The amounts here are what the owner sees
 * and what checkout verifies the Stripe price against, so a swapped or wrong price ID is refused, never charged.
 */
export const PLANS = {
  founding: { priceMinor: 3900, priceEnv: "STRIPE_PRICE_FOUNDING", label: "Gründungspreis" },
  list: { priceMinor: 4900, priceEnv: "STRIPE_PRICE_LIST", label: "Listenpreis" },
} as const;
export type PlanCode = keyof typeof PLANS;
/** Kleinunternehmer (BILLING_VAT_MODE absent or "kleinunternehmer"): the footer of every Stripe invoice and the owner page's tax line. */
export const VAT_NOTE = "Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.";
/** BILLING_VAT_MODE "standard": prices are net, Stripe adds the 19 % tax rate named by STRIPE_TAX_RATE_ID. */
export const VAT_STANDARD_NOTE = "Zuzüglich 19 % Umsatzsteuer.";
/** The start guarantee's credit line on the month-2 invoice, one per qualifying location. */
export const GUARANTEE_LINE = "Monat 2 kostenlos – Startgarantie";
export const isPlanCode = (value: unknown): value is PlanCode => value === "founding" || value === "list";

/**
 * The one price the owner page shows and the Stripe checkout charges (Finance, 24 Oct): the operator's plan, one unit per
 * location. Null until the operator has set a plan, so the page shows no amount and checkout refuses.
 */
export function planCharge(sub: { planCode: string | null; activeLocationCount: number; currency: string }) {
  if (!isPlanCode(sub.planCode) || sub.currency !== "EUR") return null;
  const unitMinor = PLANS[sub.planCode].priceMinor;
  return { planCode: sub.planCode, unitMinor, quantity: sub.activeLocationCount, totalMinor: unitMinor * sub.activeLocationCount };
}

type Env = Record<string, string | undefined>;
const price = /^price_[A-Za-z0-9]{8,}$/;
const formats: Record<string, RegExp> = {
  STRIPE_SECRET_KEY: /^(sk|rk)_(live|test)_[A-Za-z0-9]{16,}$/,
  STRIPE_WEBHOOK_SECRET: /^whsec_[A-Za-z0-9+/=]{16,}$/,
  STRIPE_PRICE_FOUNDING: price,
  STRIPE_PRICE_LIST: price,
};
const OPTIONAL_SETTINGS = ["BILLING_PRODUCTION_APPROVED", "BILLING_VAT_MODE", "STRIPE_TAX_RATE_ID", "START_GUARANTEE_MIN_CUSTOMERS", "START_GUARANTEE_CONTRACT_CUTOFF"];
const isoDay = /^\d{4}-\d{2}-\d{2}$/;

const exactFlag = (env: Env, name: string) => env[name] === undefined || env[name] === "true" || env[name] === "false";
const intIn = (value: string | undefined, min: number, max: number) => value === undefined || (/^\d+$/.test(value) && Number(value) >= min && Number(value) <= max);

/**
 * Billing is one group: LIVE_BILLING_ENABLED=true needs every Stripe setting, absent or "false" needs none. A live-mode key
 * belongs to real production only, and real production only takes a live-mode key and the founder's BILLING_PRODUCTION_APPROVED.
 * Messages name settings, never values.
 */
export function stripeConfigIssues(env: Env, production: boolean): string[] {
  const issues: string[] = [];
  for (const name of ["LIVE_BILLING_ENABLED", "BILLING_PRODUCTION_APPROVED", "START_GUARANTEE_ENABLED"]) if (!exactFlag(env, name)) issues.push(`${name} must be exactly true or false`);
  const live = env.LIVE_BILLING_ENABLED === "true";
  if (live) {
    for (const [name, format] of Object.entries(formats)) if (!format.test(env[name] ?? "")) issues.push(`Live billing requires a valid ${name}`);
    if (env.STRIPE_PRICE_FOUNDING && env.STRIPE_PRICE_FOUNDING === env.STRIPE_PRICE_LIST) issues.push("STRIPE_PRICE_FOUNDING and STRIPE_PRICE_LIST must differ");
    const liveKey = /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? "");
    if (production && !liveKey) issues.push("Production billing requires a live-mode STRIPE_SECRET_KEY");
    // Taking real money is a second explicit act on real production (CTO, 22 Oct), like Wallet's production approval; flags get copied between environments.
    if (production && env.BILLING_PRODUCTION_APPROVED !== "true") issues.push("Live billing requires a separate production approval (BILLING_PRODUCTION_APPROVED=true)");
    if (!production && liveKey) issues.push("A live-mode STRIPE_SECRET_KEY is only allowed on real production");
  } else if ([...Object.keys(formats), ...OPTIONAL_SETTINGS].some(name => env[name]) || env.START_GUARANTEE_ENABLED === "true") {
    issues.push("Stripe, VAT or start-guarantee settings are present while live billing is not enabled");
  }
  // VAT: Kleinunternehmer (§ 19 UStG) unless the operator is VAT-registered; switching needs no code change (Head of Finance, 22 Oct).
  const vat = env.BILLING_VAT_MODE;
  if (vat !== undefined && vat !== "kleinunternehmer" && vat !== "standard") issues.push("BILLING_VAT_MODE must be exactly kleinunternehmer or standard");
  if (vat === "standard" && !/^txr_[A-Za-z0-9]{8,}$/.test(env.STRIPE_TAX_RATE_ID ?? "")) issues.push("BILLING_VAT_MODE=standard requires a valid STRIPE_TAX_RATE_ID");
  if (vat !== "standard" && env.STRIPE_TAX_RATE_ID) issues.push("STRIPE_TAX_RATE_ID is set while BILLING_VAT_MODE is not standard");
  if (!intIn(env.START_GUARANTEE_MIN_CUSTOMERS, 1, 10_000)) issues.push("START_GUARANTEE_MIN_CUSTOMERS must be a whole number from 1 to 10000");
  const cutoff = env.START_GUARANTEE_CONTRACT_CUTOFF;
  if (cutoff !== undefined && (!isoDay.test(cutoff) || Number.isNaN(Date.parse(cutoff)))) issues.push("START_GUARANTEE_CONTRACT_CUTOFF must look like 2027-03-31");
  return issues;
}

export const vatMode = (env: Env = process.env) => env.BILLING_VAT_MODE === "standard" ? "standard" as const : "kleinunternehmer" as const;
export const vatNote = (env: Env = process.env) => vatMode(env) === "standard" ? VAT_STANDARD_NOTE : VAT_NOTE;

/**
 * Off unless START_GUARANTEE_ENABLED is exactly "true". A location qualifies when fewer than `minCustomers` distinct customers
 * got a team-confirmed credit in its first billing month (pilot agreement § 3 (5)); only contracts started on or before the
 * optional cut-off day (Berlin) take part. The default 20 is the founder's brief; Q-80 may change it to 10 by setting.
 */
export function guaranteeSettings(env: Env) {
  if (env.START_GUARANTEE_ENABLED !== "true") return null;
  return { minCustomers: Number(env.START_GUARANTEE_MIN_CUSTOMERS ?? 20), cutoff: env.START_GUARANTEE_CONTRACT_CUTOFF ?? null };
}

/**
 * The Stripe provider runs only with the whole group valid AND the billing surface shown; otherwise the local fixture is the
 * only provider. LIVE_BILLING_ENABLED=true is also what shows the surface on real production (lib/pilot-surfaces), so the
 * flag covers both; pilot-surfaces is not imported here because the production gate loads this file on every CLI start.
 */
export function stripeEnabled(env: Env = process.env) {
  return env.LIVE_BILLING_ENABLED === "true" && stripeConfigIssues(env, isProductionDeployment(env)).length === 0;
}
