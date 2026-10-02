import { compactEuro, euro, formatNumber, niceScale, type Point } from './calc.js';

export type Geometry = { width: number; height: number; left: number; right: number; top: number; bottom: number; xStep: number };
/** Two layouts of the same chart so axis text stays about 12 px wherever the chart is shown. */
export const WIDE: Geometry = { width: 640, height: 290, left: 82, right: 18, top: 32, bottom: 44, xStep: 2 };
export const COMPACT: Geometry = { width: 360, height: 250, left: 72, right: 14, top: 30, bottom: 46, xStep: 3 };
export const CHART = WIDE;
const plotW = (g: Geometry) => g.width - g.left - g.right, plotH = (g: Geometry) => g.height - g.top - g.bottom;
export const xAt = (month: number, months = 12, g: Geometry = WIDE) => g.left + (month / months) * plotW(g);
export const yAt = (value: number, top: number, g: Geometry = WIDE) => g.top + plotH(g) * (1 - Math.min(1, Math.max(0, value / top)));
const f = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '0');

export type PlotInput = { points: Point[]; top: number; tickStep: number; active: number | null; geometry?: Geometry };
/** The inside of the chart's <svg>: grid, axes, the gap between the series, both lines and the inspected month. Pure string output. */
export function plot({ points, top, tickStep, active, geometry: g = WIDE }: PlotInput): string {
  const months = points.length - 1;
  const X = (m: number) => xAt(m, months, g), Y = (v: number) => yAt(v, top, g);
  let grid = '';
  for (let v = 0; v <= top * 1.0001 && tickStep > 0; v += tickStep) {
    const y = Y(v);
    grid += `<line class="grid" x1="${g.left}" x2="${g.width - g.right}" y1="${f(y)}" y2="${f(y)}"/><text class="tick" x="${g.left - 10}" y="${f(y + 4)}" text-anchor="end">${compactEuro(v)}</text>`;
  }
  let xs = '';
  for (let m = 0; m <= months; m += g.xStep) xs += `<text class="tick" x="${f(X(m))}" y="${g.height - 24}" text-anchor="middle">${m}</text>`;
  xs += `<text class="axis-title" x="${g.left + plotW(g) / 2}" y="${g.height - 4}" text-anchor="middle">Monate</text>`;
  const line = (key: 'baseline' | 'scenario') => points.map((p, i) => `${i ? 'L' : 'M'}${f(X(p.month))} ${f(Y(p[key]))}`).join(' ');
  const area = `${points.map((p, i) => `${i ? 'L' : 'M'}${f(X(p.month))} ${f(Y(p.scenario))}`).join(' ')} ${[...points].reverse().map(p => `L${f(X(p.month))} ${f(Y(p.baseline))}`).join(' ')} Z`;
  let marker = '';
  if (active !== null && points[active]) {
    const p = points[active], x = X(p.month);
    marker = `<line class="cursor" x1="${f(x)}" x2="${f(x)}" y1="${g.top}" y2="${g.top + plotH(g)}"/><circle class="dot base" cx="${f(x)}" cy="${f(Y(p.baseline))}" r="5"/><circle class="dot scen" cx="${f(x)}" cy="${f(Y(p.scenario))}" r="6"/>`;
  }
  // difference label at the last month, placed below the lines so it never covers them (omitted when both series coincide)
  let gapLabel = '';
  const last = points[months];
  if (last && last.gap > 0) {
    const x = X(months), y1 = Y(last.scenario), y2 = Y(last.baseline);
    gapLabel = `<line class="gapmark" x1="${f(x)}" x2="${f(x)}" y1="${f(y1)}" y2="${f(y2)}"/><text class="gaplabel" x="${f(x)}" y="${f(Math.min(y1, y2) - 10)}" text-anchor="end">+${euro(last.gap)} Zusatzumsatz</text>`;
  }
  return `${grid}${xs}<path class="gap" d="${area}"/><path class="line base" d="${line('baseline')}"/><path class="line scen" d="${line('scenario')}"/>${gapLabel}${marker}`;
}

export function monthAtX(clientX: number, rect: DOMRect, g: Geometry = WIDE, months = 12): number {
  const x = ((clientX - rect.left) / rect.width) * g.width;
  return Math.min(months, Math.max(0, Math.round(((x - g.left) / plotW(g)) * months)));
}
export const scaleFor = (max: number) => niceScale(max);

/** Fixed readout strip above the plot: the inspected month never hides data. `idle` = nothing inspected, showing the year-end values. */
export function readoutHtml(p: Point, idle = false): string {
  return `<span class="ro-month">Monat ${p.month}${idle ? ' · Jahresende' : ''}</span><span class="ro-cell"><span class="ro-label"><i class="swatch base"></i>Ohne</span><b>${euro(p.baseline)}</b></span><span class="ro-cell"><span class="ro-label"><i class="swatch scen"></i>Mit</span><b>${euro(p.scenario)}</b></span><span class="ro-cell">Differenz<b>${euro(p.gap)}</b></span>`;
}
export function tableHtml(points: Point[]): string {
  const row = (p: Point) => `<tr><th scope="row">${p.month}</th><td>${formatNumber(p.baseline, 2)} €</td><td>${formatNumber(p.scenario, 2)} €</td><td>${formatNumber(p.gap, 2)} €</td></tr>`;
  return `<table><caption>Kumulierter Umsatz je Monat (Szenario, keine Prognose)</caption><thead><tr><th scope="col">Monat</th><th scope="col">Ohne angenommene Steigerung</th><th scope="col">Mit deiner angenommenen Steigerung</th><th scope="col">Differenz</th></tr></thead><tbody>${points.map(row).join('')}</tbody></table>`;
}
