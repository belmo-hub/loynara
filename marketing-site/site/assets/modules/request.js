import { SITE } from './site.js';
const clean = (value, max) => value.replace(/[\r\n]+/g, ' ').trim().slice(0, max);
/** The demo request is an e-mail the visitor sends themselves; nothing is transmitted by the page. */
export function buildRequest(fields) {
    const business = clean(fields.business, 120);
    if (!business)
        return null;
    const message = fields.message.replace(/\r\n/g, '\n').trim().slice(0, 1200) || 'Bitte meldet euch für einen Demo-Termin.';
    const body = ['Hallo Loynara-Team,', '', 'ich interessiere mich für eine Demo.', '', `Geschäft: ${business}`, `Branche: ${clean(fields.industry, 60) || '–'}`, `Standorte: ${clean(fields.locations, 3) || '–'}`, `Name: ${clean(fields.name, 120) || '–'}`, `Telefon (optional): ${clean(fields.phone, 40) || '–'}`, '', message].join('\n');
    const subject = `Demo-Anfrage Loynara – ${business}`;
    return { subject, body, mailto: `mailto:${SITE.supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` };
}
