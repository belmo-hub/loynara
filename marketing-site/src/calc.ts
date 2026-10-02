/**
 * The revenue scenario behind the calculator. Pure functions only: the page, the graph and the tests all use these.
 * Money is held as integer cents so that sums, ratios and the twelve-month series are exact and reproducible.
 *
 *   baseline   = visits/day × basket × opening days
 *   additional = baseline × assumed increase
 *   difference = additional − monthly fee      (revenue, not profit: goods, rewards, labour and tax are not included)
 *   annualised = difference × 12               (a constant monthly scenario, no compounding or seasonality)
 *   ratio      = additional ÷ fee              (not applicable when the fee is zero)
 */
export type FieldKey = 'visits' | 'basket' | 'days' | 'gain';
export type Limits = { min: number; max: number; step: number; decimals: number; label: string; unit: string };
export const LIMITS: Record<FieldKey, Limits> = {
  visits: { min: 0, max: 1000, step: 1, decimals: 0, label: 'Käufe pro Tag', unit: '' },
  basket: { min: 0, max: 500, step: 0.5, decimals: 2, label: 'Durchschnittlicher Einkaufswert', unit: '€' },
  days: { min: 0, max: 31, step: 1, decimals: 0, label: 'Öffnungstage pro Monat', unit: '' },
  gain: { min: 0, max: 100, step: 1, decimals: 1, label: 'Angenommene Zunahme der Käufe', unit: '%' },
};
/** Illustrative starting values (a chosen example, not a typical result). */
export const EXAMPLE: Record<FieldKey, number> = { visits: 50, basket: 7, days: 26, gain: 10 };
/** The range the sliders cover; typed values may use the full LIMITS range. */
export const SLIDER_RANGE: Record<FieldKey, { min: number; max: number; step: number }> = {
  visits: { min: 0, max: 500, step: 5 }, basket: { min: 0, max: 100, step: 0.5 }, days: { min: 0, max: 31, step: 1 }, gain: { min: 0, max: 30, step: 0.5 },
};

export type FieldState =
  | { state: 'empty' }
  | { state: 'invalid'; message: string }
  | { state: 'ok'; value: number };

/** Accepts German input ("7,50"), and a plain decimal point when it is unambiguous ("7.5"). */
export function parseField(key: FieldKey, raw: string): FieldState {
  const limits = LIMITS[key];
  const text = raw.replace(/[\s ]/g, '').replace(/[€%]/g, '');
  if (text === '') return { state: 'empty' };
  if (/^[-−–+]/.test(text)) return { state: 'invalid', message: /^[-−–]/.test(text) ? 'Negative Werte sind hier nicht möglich.' : 'Bitte ohne Vorzeichen eingeben.' };
  if (!/^[0-9.,]+$/.test(text)) return { state: 'invalid', message: 'Bitte nur Ziffern und ein Komma verwenden.' };
  if (text.includes(',') && text.includes('.')) return { state: 'invalid', message: 'Bitte nur ein Dezimaltrennzeichen verwenden, z. B. 7,50.' };
  if ((text.match(/,/g) ?? []).length > 1 || (text.match(/\./g) ?? []).length > 1) return { state: 'invalid', message: 'Bitte nur ein Dezimaltrennzeichen verwenden, z. B. 7,50.' };
  const [whole, fraction = ''] = text.split(/[.,]/);
  if (whole === '' && fraction === '') return { state: 'invalid', message: 'Bitte eine Zahl eingeben.' };
  if (text.includes('.') && fraction.length === 3) return { state: 'invalid', message: 'Bitte ein Komma als Dezimaltrennzeichen verwenden.' };
  if (limits.decimals === 0 && /[.,]/.test(text)) return { state: 'invalid', message: 'Bitte eine ganze Zahl eingeben.' };
  if (fraction.length > limits.decimals) return { state: 'invalid', message: `Höchstens ${limits.decimals} Nachkommastelle${limits.decimals === 1 ? '' : 'n'}.` };
  const value = Number(`${whole || '0'}.${fraction || '0'}`);
  if (!Number.isFinite(value)) return { state: 'invalid', message: 'Bitte eine Zahl eingeben.' };
  if (value < limits.min || value > limits.max) return { state: 'invalid', message: `Bitte einen Wert zwischen ${formatNumber(limits.min, 0)} und ${formatNumber(limits.max, 0)} eingeben.` };
  return { state: 'ok', value };
}

export type Inputs = Record<FieldKey, number>;
export type Scenario = {
  fee: number;
  baseline: number; additional: number; scenario: number; difference: number; annualised: number;
  /** null when the fee is zero (not applicable) */
  ratio: number | null;
};
const toCents = (euro: number) => Math.round(euro * 100);
/** Exact integer arithmetic: visits × basket-cents × days, gain in tenths of a percent. */
export function compute(input: Inputs, fee: number): Scenario {
  const feeCents = toCents(fee);
  const baselineCents = Math.round(input.visits) * toCents(input.basket) * Math.round(input.days);
  const additionalCents = Math.round(baselineCents * Math.round(input.gain * 10) / 1000);
  const differenceCents = additionalCents - feeCents;
  return {
    fee, baseline: baselineCents / 100, additional: additionalCents / 100, scenario: (baselineCents + additionalCents) / 100,
    difference: differenceCents / 100, annualised: (differenceCents * 12) / 100,
    ratio: feeCents === 0 ? null : additionalCents / feeCents,
  };
}

export type Point = { month: number; baseline: number; scenario: number; gap: number };
/** Cumulative revenue per month, months 0…12, constant monthly values. */
export function series(s: Scenario, months = 12): Point[] {
  return Array.from({ length: months + 1 }, (_, month) => ({
    month, baseline: Math.round(month * s.baseline * 100) / 100, scenario: Math.round(month * s.scenario * 100) / 100,
    gap: Math.round(month * s.additional * 100) / 100,
  }));
}

// ---- formatting (de-DE) -------------------------------------------------------------------------------------------
const nf = new Map<number, Intl.NumberFormat>();
export function formatNumber(value: number, decimals = 0): string {
  let f = nf.get(decimals);
  if (!f) { f = new Intl.NumberFormat('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); nf.set(decimals, f); }
  return f.format(Object.is(value, -0) ? 0 : value);
}
/** Whole euros everywhere in the summary; the table shows cents. Negative values use a true minus sign. */
export const euro = (value: number, decimals = 0) => `${value < 0 && Number(Math.abs(value).toFixed(decimals)) > 0 ? '−' : ''}${formatNumber(Math.abs(value), decimals)} €`;
export const signedEuro = (value: number) => (value > 0 ? '+' : '') + euro(value);
export function ratioText(ratio: number | null): string {
  if (ratio === null) return 'nicht anwendbar';
  if (ratio === 0) return '0×';
  return `${formatNumber(ratio, ratio < 100 ? 1 : 0)}×`;
}
/** Compact axis label, e.g. "10 Tsd. €". */
export function compactEuro(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${formatNumber(value / 1e6, abs >= 1e7 ? 0 : 1)} Mio. €`;
  if (abs >= 1e4) return `${formatNumber(value / 1e3, 0)} Tsd. €`;
  if (abs >= 1e3) return `${formatNumber(value / 1e3, 1)} Tsd. €`;
  return `${formatNumber(value, 0)} €`;
}
/** A readable axis ceiling and step (about four intervals) for a maximum value. */
export function niceScale(max: number): { top: number; step: number } {
  if (!(max > 0)) return { top: 1000, step: 250 };
  const pow = 10 ** Math.floor(Math.log10(max / 4));
  let best: { top: number; step: number; n: number } | null = null;
  for (const unit of [pow / 10, pow, pow * 10]) for (const m of [1, 2, 2.5, 5]) {
    const step = m * unit, n = Math.ceil(max / step - 1e-9), top = n * step;
    if (n < 3 || n > 6) continue;
    if (!best || top < best.top - 1e-9 || (Math.abs(top - best.top) < 1e-9 && n < best.n)) best = { top, step, n };
  }
  return best ? { top: best.top, step: best.step } : { top: Math.ceil(max / (max / 4)) * (max / 4), step: max / 4 };
}
