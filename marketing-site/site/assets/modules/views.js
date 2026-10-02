import { industries } from './site.js';
import { balance, visits } from './demo.js';
export const escapeText = (s) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function stamps(n, threshold) {
    return Array.from({ length: threshold }, (_, i) => `<span class="stamp${i < n ? ' filled' : ''}" aria-hidden="true">${i < n ? '✓' : String(i + 1).padStart(2, '0')}</span>`).join('');
}
export const STEP_TITLES = ['Der Kunde kommt an', 'Der Kunde öffnet seine Karte', 'Dein Team bestätigt', 'Du siehst, was passiert'];
export const stepDescription = (s, key) => {
    const x = industries[key];
    switch (s.step) {
        case 0: return 'Am Tresen wartet ein NFC-Schild und ein QR-Code. Wähle, wie dein Kunde ankommt.';
        case 1: return s.entry === 'nfc'
            ? 'Der Tap öffnet eine Webseite – keine App nötig. Ein neuer Kunde erstellt hier seine Karte.'
            : 'Der QR-Code öffnet dieselbe Webseite – keine App nötig. Ein neuer Kunde erstellt hier seine Karte.';
        case 2: return s.entry === 'nfc'
            ? 'Die Anfrage erscheint auf dem Kassenbildschirm deines Teams. Erst mit der Bestätigung wird ein Stempel vergeben.'
            : 'Dein Team scannt den QR-Code der Karte und bestätigt den Besuch. Erst dann wird ein Stempel vergeben.';
        default: return `Jeder bestätigte Besuch ist nachvollziehbar. Nach ${x.threshold} Stempeln gibt es ${x.reward}.`;
    }
};
/** The three views are always visible so that customer, cashier and owner stay connected; the active one is highlighted. */
export function demoScreens(s, key) {
    const x = industries[key], n = balance(s), th = s.threshold;
    const active = (i) => (i === s.step || (s.step === 3 && i === 2) ? ' is-active' : '');
    const customerActive = s.step <= 1 ? ' is-active' : '';
    const status = s.redeemed ? 'Prämie eingelöst' : n >= th ? 'Prämie verfügbar' : s.enrolled ? `Noch ${th - n} bis zur Prämie` : 'Noch keine Karte';
    const entryLabel = s.entry === 'nfc' ? 'NFC-Tap' : s.entry === 'qr' ? 'QR-Code' : '';
    let customerBody;
    if (s.step === 0) {
        customerBody = `<div class="entry-choice"><p>Wie kommt dein Kunde an?</p><div class="entry-buttons"><button type="button" class="button ${s.entry === 'nfc' ? 'primary' : 'secondary'}" data-action="nfc" aria-pressed="${s.entry === 'nfc'}">NFC-Schild antippen</button><button type="button" class="button ${s.entry === 'qr' ? 'primary' : 'secondary'}" data-action="qr" aria-pressed="${s.entry === 'qr'}">QR-Code scannen</button></div></div>`;
    }
    else if (!s.enrolled) {
        customerBody = `<div class="entry-choice"><p><strong>Neu hier?</strong> Deine Karte entsteht in wenigen Sekunden – ohne App.</p><button type="button" class="button primary" data-action="enroll">Karte erstellen</button></div>`;
    }
    else if (s.step === 2 && !s.confirmed) {
        customerBody = `<p class="screen-note" role="status">${s.requested ? 'Anfrage gesendet – dein Team bestätigt gleich.' : 'Zeige deinen QR-Code an der Kasse.'}</p>`;
    }
    else {
        customerBody = `<p class="screen-note" role="status">${s.confirmed ? '✓ Besuch bestätigt – Stempel erhalten.' : 'Karte erstellt.'}</p>`;
    }
    const activity = s.confirmed ? `<li><span>${escapeText(x.visit.charAt(0).toUpperCase() + x.visit.slice(1))}</span><strong>+1 Stempel</strong></li>${s.extra ? `<li><span>${s.extra} weitere bestätigte Besuche (Simulation)</span><strong>+${s.extra} Stempel</strong></li>` : ''}${s.redeemed ? `<li><span>Prämie eingelöst</span><strong>−${th} Stempel</strong></li>` : ''}` : '';
    let cashierBody;
    if (s.step < 2)
        cashierBody = `<p class="screen-note">Hier bestätigt dein Team Besuche. Bezahlt wird wie bisher.</p>`;
    else if (s.confirmed)
        cashierBody = `<p class="screen-note success" role="status">✓ Bestätigt – ein Stempel vergeben.</p>`;
    else if (s.requested)
        cashierBody = `<div class="request"><div><strong>Neue Anfrage</strong><span>Karte 001 · ${entryLabel}</span></div><button type="button" class="button primary" data-action="confirm">Besuch bestätigen</button></div>`;
    else
        cashierBody = `<div class="request"><div><strong>Karte scannen</strong><span>Das Team scannt den QR-Code des Kunden.</span></div><button type="button" class="button ink" data-action="scan">QR-Code scannen</button></div>`;
    const ownerBody = s.step < 3
        ? `<p class="screen-note">Sobald ein Besuch bestätigt ist, erscheint er hier.</p>`
        : `<div class="metrics"><div><span>Kundenkarten</span><strong>1</strong></div><div><span>Bestätigte Besuche</span><strong>${visits(s)}</strong></div><div><span>Prämien eingelöst</span><strong>${s.redeemed ? 1 : 0}</strong></div></div><ul class="activity">${activity}</ul>${s.extra === 0 ? `<button type="button" class="button secondary" data-action="more">Weitere Besuche simulieren</button>` : n === th ? `<button type="button" class="button primary" data-action="redeem">Prämie einlösen</button>` : ''}`;
    return `<section class="screen customer${customerActive}" aria-label="Kundensicht"><h3><span class="tag">Kunde</span> Karte im Browser</h3><div class="demo-card"><div class="card-top"><img src="/assets/loynara-mark.svg" width="26" height="26" alt=""><span>${escapeText(x.name)}</span></div><p>${escapeText(x.reward)} · nach ${th} Stempeln</p><div class="stamp-grid">${stamps(s.enrolled ? n : 0, th)}</div><div class="card-total"><strong>${s.enrolled ? n : 0}<small> / ${th}</small></strong><span>${status}</span></div></div>${customerBody}</section>
<section class="screen cashier${active(2)}" aria-label="Kassensicht"><h3><span class="tag">Kasse</span> Team bestätigt</h3>${cashierBody}</section>
<section class="screen owner${s.step === 3 ? ' is-active' : ''}" aria-label="Inhaberansicht"><h3><span class="tag">Inhaber</span> Überblick</h3>${ownerBody}</section>`;
}
