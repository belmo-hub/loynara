import { SITE } from './site.js';

export type RequestFields = { business: string; industry: string; message: string; /** only set after the visitor explicitly chose to share the calculator numbers */ figures?: string };
const clean = (value: string, max: number) => value.replace(/[\r\n\u2028\u2029]+/g, ' ').trim().slice(0, max);

/** The demo request is an e-mail the visitor sends themselves; nothing is transmitted by the page. */
export function buildRequest(fields: RequestFields): { subject: string; body: string; mailto: string } | null {
  const business = clean(fields.business, 120);
  if (!business) return null;
  const message = fields.message.replace(/\r\n?/g, '\n').trim().slice(0, 1200) || 'Bitte meldet euch für einen Demo-Termin.';
  const lines = ['Hallo Loynara-Team,', '', 'ich interessiere mich für eine Demo.', '', `Geschäft: ${business}`, `Branche: ${clean(fields.industry, 60) || '–'}`, '', message];
  if (fields.figures) lines.push('', 'Meine Rechenbeispiel-Zahlen (Szenario, keine Prognose):', fields.figures.replace(/\r\n?/g, '\n').slice(0, 600));
  const body = lines.join('\n');
  const subject = `Demo-Anfrage Loynara – ${business}`;
  return { subject, body, mailto: `mailto:${SITE.supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` };
}
