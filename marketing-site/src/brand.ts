/** Merchant branding example state. Page memory only: nothing is uploaded, saved or sent. Independent of loyalty, referral and calculator state. */
import type { IndustryKey } from './site.js';
import { industries } from './site.js';

export type StyleKey = 'wald' | 'terrakotta' | 'nachtblau' | 'pflaume' | 'graphit';
export type LogoKey = 'monogramm' | 'blatt' | 'welle';
export type RewardKey = 'branche' | 'aufmerksamkeit' | 'extra';
export type BrandState = { style: StyleKey; logo: LogoKey; reward: RewardKey };
export const initialBrand = (): BrandState => ({ style: 'wald', logo: 'monogramm', reward: 'branche' });

/** The colour presets mirror the card studio of the application (Waldgrün, Terrakotta, Nachtblau, Pflaume, Graphit). */
export const STYLES: Record<StyleKey, { label: string; dark: string; mid: string; accent: string; soft: string }> = {
  wald: { label: 'Waldgrün', dark: '#143D2E', mid: '#245D47', accent: '#F4DDD0', soft: '#E6EEDF' },
  terrakotta: { label: 'Terrakotta', dark: '#7A3320', mid: '#A8472B', accent: '#FBE6D6', soft: '#F6E4DA' },
  nachtblau: { label: 'Nachtblau', dark: '#16264A', mid: '#26407A', accent: '#DCE6FA', soft: '#E3E9F5' },
  pflaume: { label: 'Pflaume', dark: '#4A1D44', mid: '#702C68', accent: '#F3DCEF', soft: '#EFE0EC' },
  graphit: { label: 'Graphit', dark: '#1C2326', mid: '#37424A', accent: '#E3E8EA', soft: '#E6E9EA' },
};
export const LOGOS: Record<LogoKey, { label: string; svg: string }> = {
  monogramm: { label: 'Monogramm', svg: '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M10 22V10l6 8 6-8v12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
  blatt: { label: 'Blatt', svg: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 26C6 12 14 6 26 6c0 12-6 20-18 20z" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/><path d="M6 26 18 14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>' },
  welle: { label: 'Welle', svg: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 12c4-6 6 6 10 0s6 6 10 0 4 2 6 0M3 22c4-6 6 6 10 0s6 6 10 0 4 2 6 0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>' },
};
export const REWARD_LABELS: Record<RewardKey, string> = { branche: 'Branchenbeispiel', aufmerksamkeit: 'Kleine Aufmerksamkeit', extra: 'Extra zum nächsten Besuch' };

/** Reward as nominative noun phrase with article, so "dann wartet … auf dich" reads correctly for every option. */
export function rewardText(b: BrandState, industry: IndustryKey): string {
  return b.reward === 'branche' ? industries[industry].reward : b.reward === 'aufmerksamkeit' ? 'eine kleine Aufmerksamkeit aufs Haus' : 'ein Extra zum nächsten Besuch';
}
export const isStyle = (v: string | undefined): v is StyleKey => !!v && v in STYLES;
export const isLogo = (v: string | undefined): v is LogoKey => !!v && v in LOGOS;
export const isReward = (v: string | undefined): v is RewardKey => !!v && v in REWARD_LABELS;
export const brandVars = (b: BrandState) => { const s = STYLES[b.style]; return `--b-dark:${s.dark};--b-mid:${s.mid};--b-accent:${s.accent};--b-soft:${s.soft}`; };
