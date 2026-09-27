import { industries, offers, periodCost, euro } from './config.js';
import { initialDemo, transition, balance, canAdvance } from './demo.js';
import { demoScreens, escapeText, stamps } from './views.js';
import { parseMoney, calculate } from './economics.js';
const $ = (id) => document.getElementById(id);
const input = (id) => $(id);
let industry = (document.body.dataset.industry || 'cafe');
let state = initialDemo(industries[industry].threshold);
const storyState = { return: 0, referral: 0 };
const say = (message) => { $('demo-announcement').textContent = message; };
function changeView(next) { $('demo-screens').dataset.view = next; document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === next))); }
function renderDemo() {
    const x = industries[industry], n = balance(state), target = x.threshold;
    const titles = ['Dein Geschäft legt die Prämie fest.', 'Der Kunde öffnet seine Karte.', 'Bezahlt wird wie bisher.', 'Dein Team bestätigt den Einkauf.', 'Fortschritt und Aktivität sind sichtbar.'];
    const descriptions = [`Die Prämie: ${x.reward}. Dafür braucht es ${target} Stempel. Dein Team kennt die Regel; deine Kunden sehen ihren Fortschritt.`, 'Im Geschäft öffnet der Anmelde-QR die Teilnahme. Nach dem Beitritt startet die Browserkarte bei null.', 'Der Kunde bezahlt an deiner bestehenden Kasse. Loynara erhält keine automatische Zahlungsbestätigung.', 'Das Team scannt den Kunden-QR, prüft den Einkauf und bestätigt ausdrücklich einen Stempel.', 'Karte und Inhaberansicht beziehen sich auf dieselben Bestätigungen. Schau dir beide Perspektiven an.'];
    $('step-counter').textContent = `SCHRITT ${state.step + 1} VON 5`;
    $('step-title').textContent = titles[state.step];
    $('step-description').textContent = descriptions[state.step];
    document.querySelectorAll('.step-track li').forEach((li, i) => { if (i === state.step)
        li.setAttribute('aria-current', 'step');
    else
        li.removeAttribute('aria-current'); });
    $('demo-screens').innerHTML = demoScreens(state, industry, input('business-name').value.trim());
    $('demo-screens').classList.remove('changed');
    requestAnimationFrame(() => $('demo-screens').classList.add('changed'));
    const next = $('demo-next');
    next.disabled = !canAdvance(state);
    next.textContent = state.step === 0 ? 'Start →' : state.step === 4 ? 'Rundgang abgeschlossen' : 'Weiter →';
    $('demo-back').disabled = state.step === 0;
    $('step-hint').textContent = state.step === 1 && !state.enrolled ? 'Öffne zuerst die Beispielkarte in der Kundensicht.' : state.step === 3 && !state.confirmed ? 'Identifiziere die Karte und bestätige +1 in der Kassensicht.' : state.step === 4 ? 'Du kannst die Perspektive wechseln oder spätere Besuche ansehen.' : 'Du entscheidest, wann es weitergeht.';
    const later = $('later-visits');
    later.hidden = state.step !== 4;
    later.innerHTML = state.redeemed ? `<p><strong>Prämie bestätigt eingelöst.</strong> ${target} bestätigte Besuche, 1 Einlösung, 0 Stempel übrig. Die Inhaberansicht zeigt dieselbe Geschichte.</p>` : state.later === target - 1 ? `<p><strong>${target} von ${target} Stempeln.</strong> Nach dem letzten bestätigten Besuch ist die Prämie verfügbar. Das Team bestätigt auch die Einlösung.</p><button class="button ink" data-action="redeem">Prämie einlösen bestätigen</button>` : state.later === target - 2 ? `<p><strong>Zeitsprung: ${target - 2} weitere, jeweils bestätigte Besuche.</strong> Der Stand ist jetzt ${target - 1}/${target}. Bestätige den nächsten Besuch selbst.</p><button class="button ink" data-action="last">Besuch ${target}: +1 Stempel bestätigen</button>` : `<p><strong>Was passiert beim nächsten Besuch?</strong> Springe ausdrücklich zu ${target - 2} weiteren bestätigten Besuchen. Das ist ein Zeitraffer, kein zusätzlicher Effekt dieses Einkaufs.</p><button class="button secondary" data-action="jump">Zeitsprung: ${target - 2} weitere Besuche →</button>`;
    say(`Schritt ${state.step + 1}: ${titles[state.step]} Kartenstand ${n} von ${target} Stempeln.`);
}
function resetDemo() { state = initialDemo(industries[industry].threshold); changeView('customer'); renderDemo(); storyState.return = 0; storyState.referral = 0; renderStories(); }
$('demo-next').addEventListener('click', () => { state = transition(state, 'next'); changeView(state.step === 2 || state.step === 3 ? 'cashier' : 'customer'); renderDemo(); });
$('demo-back').addEventListener('click', () => { state = transition(state, 'back'); changeView(state.step === 2 || state.step === 3 ? 'cashier' : 'customer'); renderDemo(); });
$('reset-demo').addEventListener('click', () => { resetDemo(); $('demo-next').focus(); });
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => changeView(b.dataset.view)));
document.querySelector('.demo-shell').addEventListener('click', e => {
    const button = e.target.closest('[data-action]');
    if (!button)
        return;
    const action = button.dataset.action;
    state = transition(state, action);
    renderDemo();
    const target = action === 'identify' ? '[data-action="award"]' : action === 'jump' ? '[data-action="last"]' : action === 'last' ? '[data-action="redeem"]' : action === 'redeem' ? '#reset-demo' : '#demo-next';
    document.querySelector(target)?.focus({ preventScroll: true });
});
function updateIndustry() {
    const x = industries[industry];
    $('industry-threshold').textContent = String(x.threshold);
    $('industry-intro').textContent = x.introduction;
    $('industry-visit').textContent = x.visit;
    $('industry-reward').textContent = x.reward;
    input('business-name').placeholder = x.name;
    document.querySelectorAll('[data-business]').forEach(el => el.textContent = input('business-name').value.trim() || x.name);
    document.querySelectorAll('[data-reward]').forEach(el => el.textContent = `${x.reward} · nach ${x.threshold} Stempeln`);
    document.querySelectorAll('[data-industry-choice]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.industryChoice === industry)));
    $('industry-variant').hidden = true;
    $('return-industry').textContent = x.offer;
    $('referral-industry').textContent = x.referral;
    document.querySelector('.hero-card').classList.remove('changed');
    requestAnimationFrame(() => document.querySelector('.hero-card').classList.add('changed'));
    heroStage = 0;
    renderHero();
    resetDemo();
    say(`${x.label} ausgewählt. Demo neu gestartet. Deine Rechenwerte bleiben unverändert.`);
}
document.querySelectorAll('[data-industry-choice]').forEach(b => b.addEventListener('click', () => { industry = b.dataset.industryChoice; updateIndustry(); }));
$('variant').addEventListener('change', () => { industry = $('variant').value; updateIndustry(); });
input('business-name').addEventListener('input', () => { document.querySelectorAll('[data-business]').forEach(el => el.textContent = input('business-name').value.trim() || industries[industry].name); renderDemo(); renderStories(); });
function renderStories() {
    const x = industries[industry];
    const stories = {
        return: [['01 / ERFASSTE AKTIVITÄT', 'Ein Anlass, genauer hinzusehen.', `${x.interval}. Eine ruhige Karte allein sagt nichts über die Gründe aus.`, 'Zielgruppe ansehen →'], ['02 / PASSENDE ZIELGRUPPE', 'Eine Karte passt zur Auswahl.', 'Beispielkarte A-01 passt zum selbst gewählten Zeitraum. Versandberechtigt nur mit verifiziertem Kontakt und passender, nicht widerrufener Einwilligung.', 'Angebot vorbereiten →'], ['03 / ENTWURF DES GESCHÄFTS', 'Du bestimmst Anlass und Inhalt.', `${x.offer} Das Geschäft prüft Zielgruppe, Kosten und Konditionen vor einer Freigabe.`, 'Nachrichtenvorschau →'], ['04 / NACHRICHTENVORSCHAU', 'Eine Einladung, kein Automatismus.', `„Wir freuen uns auf deinen nächsten Besuch bei ${input('business-name').value.trim() || x.name}. Frage uns nach unserem aktuellen Angebot.“ Versand in dieser Demo simuliert. Kein Empfänger wird kontaktiert.`, 'Illustratives Wiederkommen →'], ['05 / REINES BEISPIEL', 'Beispiel: Kunde kommt später zurück.', 'Das Team bestätigt einen neuen Besuch. Ob die Nachricht dafür ursächlich war, wissen wir nicht. Das ist kein gemessener Kampagnenerfolg.', 'Beispiel abgeschlossen']],
        referral: [['01 / EINLADUNG', 'Eine persönliche Empfehlung.', 'Beispielregel: Karte R-01 erhält 1 Bonusstempel, sobald die neue Karte R-02 ihren ersten qualifizierenden Einkauf bestätigt bekommt.', 'Einladung öffnen →'], ['02 / LINK GEÖFFNET', 'Noch keine Belohnung.', 'Eine Einladung wurde geöffnet. Karte R-01: 0 Bonusstempel. Ein Linkaufruf ist kein Einkauf.', 'Empfohlene Karte anmelden →'], ['03 / NEUE KARTE', 'Zuordnung gespeichert, Bonus wartet.', 'Beispielkarte R-02 ist R-01 zugeordnet. R-02: 0 Stempel. R-01: 0 Bonusstempel. Erst ein qualifizierender Einkauf zählt.', 'Qualifizierenden Einkauf bestätigen →'], ['04 / EINKAUF BESTÄTIGT', 'Jetzt zählt die Empfehlung.', 'Das Team hat den ersten qualifizierenden Einkauf von R-02 bestätigt: +1 regulärer Stempel für R-02, einmalig +1 Bonusstempel für R-01. Erneutes Öffnen gibt keinen weiteren Bonus.', 'Beispiel abgeschlossen']],
    };
    for (const key of ['return', 'referral']) {
        const idx = storyState[key], s = stories[key][idx];
        $(`${key}-flow`).dataset.stage = String(idx);
        $(`${key}-flow`).innerHTML = `<div class="story-visual" aria-hidden="true">${key === 'return' ? `<span class="story-member">A-01</span><span class="story-connector">→</span><span class="story-token">${['Besuchspause', 'Zielgruppe', 'Angebotsentwurf', 'Nachrichtenvorschau', 'Beispiel: Wiederkehr'][idx]}</span>` : `<span class="story-member">R-01</span><span class="story-connector">→</span><span class="story-member">R-02</span><span class="story-token">${idx === 3 ? '+1 Bonus bestätigt' : '0 Bonusstempel'}</span>`}</div><span>${s[0]}</span><h3>${s[1]}</h3><p>${escapeText(s[2])}</p>`;
        const next = document.querySelector(`[data-story-next="${key}"]`);
        next.textContent = s[3];
        next.disabled = idx === stories[key].length - 1;
        document.querySelector(`[data-story-back="${key}"]`).disabled = idx === 0;
    }
}
for (const direction of ['next', 'back', 'reset'])
    document.querySelectorAll(`[data-story-${direction}]`).forEach(b => b.addEventListener('click', () => { const key = b.dataset[`story${direction[0].toUpperCase() + direction.slice(1)}`]; storyState[key] = direction === 'reset' ? 0 : Math.max(0, Math.min(key === 'return' ? 4 : 3, storyState[key] + (direction === 'next' ? 1 : -1))); renderStories(); if (b.disabled)
        document.querySelector(`[data-story-reset="${key}"]`).focus({ preventScroll: true }); }));
let examples = false;
function recalculate() {
    const offer = $('offer').value, period = $('period').value;
    const fee = periodCost(offer, period);
    $('fee').textContent = euro(fee);
    $('period-label').textContent = period === 'first' ? 'Erster Monat inklusive Einrichtung' : 'Monatliche Softwaregebühr';
    $('assumption-label').textContent = examples ? 'Beispielannahmen geladen. Änderungen sind deine Annahmen, keine Prognose. Alle Werte bleiben auf dieser Seite.' : 'Deine Eingaben bleiben auf dieser Seite und werden nicht übertragen.';
    $('calc-error').textContent = '';
    for (const id of ['contribution', 'rewards', 'effort', 'revenue', 'visits'])
        input(id).removeAttribute('aria-invalid');
    try {
        const read = (id) => { try {
            return parseMoney(input(id).value);
        }
        catch (e) {
            input(id).setAttribute('aria-invalid', 'true');
            throw e;
        } };
        const m = read('contribution'), b = read('rewards'), h = read('effort'), r = read('revenue'), rawN = input('visits').value.trim();
        for (const [id, v] of [['rewards', b], ['effort', h], ['revenue', r]])
            if (v !== null && v < 0) {
                input(id).setAttribute('aria-invalid', 'true');
                throw new Error('Prämienkosten, Betriebsaufwand und Umsatz dürfen nicht negativ sein.');
            }
        let n = null;
        if (rawN) {
            if (!/^\d+$/.test(rawN) || Number(rawN) > 100000) {
                input('visits').setAttribute('aria-invalid', 'true');
                throw new Error('Bitte 0 bis 100.000 ganze zusätzliche Besuche eingeben.');
            }
            n = Number(rawN);
        }
        const result = calculate(fee, m, b, h, n, r);
        $('required').textContent = result.required === null ? '–' : new Intl.NumberFormat('de-DE').format(result.required);
        $('visit-frequency').textContent = result.required !== null && result.required > 0 && period === 'recurring' ? result.required <= 30 ? `≈ ein zusätzlicher Besuch alle ${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(30 / result.required)} Tage (30-Tage-Monat)` : `≈ ${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 }).format(result.required / 30)} zusätzliche Besuche pro Tag (30-Tage-Monat)` : '';
        $('required').classList.toggle('compact-number', String(result.required ?? '').length > 5);
        $('required-label').textContent = result.required === 1 ? 'zusätzlicher Besuch' : 'zusätzliche Besuche';
        $('result-explanation').textContent = m === null ? 'Trage deinen geschätzten Beitrag je zusätzlichem Besuch ein.' : m <= 0 ? 'Kein endlicher Kostenausgleich: Wenn je zusätzlichem Besuch nichts oder weniger als null übrig bleibt, decken weitere Besuche die Fixkosten nicht.' : `${result.complete ? 'Mit allen angegebenen Kosten' : 'Untergrenze mit den bisher angegebenen Kosten'}: ${euro(result.cost)} ÷ ${euro(m)}, auf ganze Besuche aufgerundet.`;
        let caveat = result.complete ? 'Berücksichtigt die gewählten Software-/Einrichtungskosten und die von dir angegebenen zusätzlichen Prämien- und Betriebskosten.' : b === null && h === null ? (period === 'first' ? 'Deckt zunächst nur Einrichtung und ersten Monat. Weitere Programm- und Betriebskosten sind noch nicht berücksichtigt.' : 'Deckt zunächst nur die monatliche Softwaregebühr. Weitere Programm- und Betriebskosten sind noch nicht berücksichtigt.') : 'Unvollständige Kostenannahme: Ein leeres Kostenfeld ist unbekannt, nicht bestätigte 0 €. Das Ergebnis ist eine Untergrenze.';
        if (offers[offer].draft)
            caveat = 'Privater Paketentwurf, nicht freigegeben. ' + caveat;
        $('cost-caveat').textContent = caveat;
        $('scenario').hidden = n === null;
        $('scenario-revenue').textContent = result.revenue === null ? 'Umsatz fehlt' : euro(result.revenue);
        $('scenario-change').textContent = result.change === null ? 'Angaben fehlen' : euro(result.change);
        $('scenario-change').classList.toggle('negative', result.change !== null && result.change < 0);
    }
    catch (e) {
        $('visit-frequency').textContent = '';
        $('calc-error').textContent = e instanceof Error ? e.message : 'Bitte die Eingaben prüfen.';
        $('required').textContent = '–';
        $('result-explanation').textContent = 'Bitte die markierten Eingaben prüfen.';
        $('scenario').hidden = true;
        $('cost-caveat').textContent = 'Es wird kein Ergebnis aus ungültigen Eingaben angezeigt.';
    }
}
$('calculator').addEventListener('submit', e => e.preventDefault());
$('calculator').addEventListener('input', recalculate);
$('calculator').addEventListener('change', recalculate);
$('calculator').addEventListener('reset', () => { examples = false; requestAnimationFrame(recalculate); });
$('load-example').addEventListener('click', () => { examples = true; for (const [id, v] of Object.entries({ contribution: '8', rewards: '20', effort: '10', revenue: '18', visits: '10' }))
    input(id).value = v; $('calc-details').open = true; recalculate(); });
$('use-draft').addEventListener('click', () => { $('offer').value = 'introDraft'; $('period').value = 'first'; recalculate(); $('rechner').scrollIntoView(); $('offer').focus({ preventScroll: true }); });
const features = {
    growth: { src: 'referrals.webp', alt: 'Echter Empfehlungsbericht mit synthetischer Bonusqualifikation', caption: 'Empfehlungsbericht · echte Anwendung mit Beispieldaten', status: 'Lokal mit Beispieldaten geprüft', detail: 'Empfehlungen werden zugeordnet und erst nach dem qualifizierenden Besuch belohnt. Rollen und Standorte begrenzen Teamzugriffe. Anonyme Identitäten lassen sich nicht perfekt deduplizieren.' },
    programme: { src: 'rewards.webp', alt: 'Echte Prämienverwaltung mit zwei synthetischen Prämienstufen', caption: 'Prämienverwaltung · separates 5-/10-Stempel-Beispiel aus der Anwendung', status: 'Im geschützten Pilot', detail: 'Regeln, Markenauftritt und eine geordnete Auswahl an Prämien werden gespeichert. Guthaben bleibt im definierten Programm und Standort.' },
    activity: { src: 'merchant-dashboard.webp', alt: 'Echte Inhaberübersicht mit synthetischen Buchungen', caption: 'Aktivitätsübersicht · echte Anwendung mit Beispieldaten', status: 'Im geschützten Pilot', detail: 'Pseudonyme Karten und Buchungen machen erfasste Aktivität sichtbar. Berichte zeigen Datenfenster und Zählregeln. Erfasste Käufe allein beweisen keinen zusätzlichen Umsatz.' },
    offers: { src: 'campaign.webp', alt: 'Echter Kampagnenentwurf mit synthetischer Zielgruppe', caption: 'Kampagnenentwurf · echte Anwendung mit Beispieldaten', status: 'Vorbereitung lokal geprüft · externer Versand in Vorbereitung', detail: 'Zielgruppen, Entwürfe, Planung und Einwilligungsprüfung sind lokal getestet. Nachrichten wurden nur lokal aufgefangen. Empfehlungen belohnen erst ein konfiguriertes, bestätigtes Ereignis.' },
};
document.querySelectorAll('[data-feature]').forEach(b => b.addEventListener('click', () => { const f = features[b.dataset.feature]; document.querySelectorAll('[data-feature]').forEach(v => v.setAttribute('aria-pressed', String(v === b))); const img = $('feature-image'); img.src = `/assets/${f.src}`; img.alt = f.alt; $('feature-caption').textContent = f.caption; $('feature-detail').innerHTML = `<strong>${f.status}</strong><p>${f.detail}</p>`; }));
$('contact-draft').addEventListener('submit', e => e.preventDefault());
$('download-brief').addEventListener('click', () => { const business = input('contact-business').value.trim() || input('business-name').value.trim() || industries[industry].name; const content = `Loynara – Gesprächsnotiz (lokal erstellt, nicht gesendet)\n\nGeschäft: ${business}\nBereich: ${industries[industry].label}\nKontakt (optional): ${input('contact-email').value.trim()}\n\nMeine Fragen:\n${$('contact-question').value}\n\nPreisvorschläge und Vertragsbedingungen vor einer Bestellung abstimmen.\n`; const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'loynara-gespraechsnotiz.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); $('brief-status').textContent = 'Notiz lokal heruntergeladen. Keine Anfrage versendet.'; });
let heroStage = 0;
function renderHero() {
    const target = industries[industry].threshold, count = heroStage === 0 ? 0 : heroStage === 3 ? 2 : 1;
    $('hero-stamps').innerHTML = stamps(count, target);
    $('hero-balance').innerHTML = `${count}<small> / ${target} Stempel</small>`;
    $('hero-remaining').textContent = `Noch ${target - count} bis zur Prämie`;
    $('hero-owner-count').textContent = String(count);
    $('hero-activity').textContent = count === 0 ? 'Noch keine bestätigte Aktivität' : `${count} bestätigte Beispielbesuche`;
    $('hero-confirm-title').textContent = ['Du bestätigst den Besuch.', 'Ein Stempel. Sichtbarer Fortschritt.', 'Du siehst, was gebucht wurde.', 'Beispiel: ein späterer Besuch.'][heroStage];
    $('hero-confirm-copy').textContent = ['Bezahlen läuft über deine Kasse.', '+1 nach ausdrücklicher Bestätigung.', 'Ein bestätigter Besuch, ein Eintrag.', 'Erneut vom Team bestätigt. Stand: 2.'][heroStage];
    $('hero-play').innerHTML = ['Besuch bestätigen →', 'Aktivität ansehen →', 'Späteren Besuch zeigen →', 'Vorschau neu starten ↺'][heroStage];
    document.querySelectorAll('.hero-stage-dots span').forEach((el, i) => { if (i === heroStage)
        el.setAttribute('aria-current', 'step');
    else
        el.removeAttribute('aria-current'); });
    document.querySelector('.hero-scene').dataset.stage = String(heroStage);
}
$('hero-play').addEventListener('click', () => { heroStage = (heroStage + 1) % 4; renderHero(); });
const menu = $('menu-toggle');
menu.addEventListener('click', () => { const open = menu.getAttribute('aria-expanded') !== 'true'; menu.setAttribute('aria-expanded', String(open)); $('main-nav').classList.toggle('open', open); });
$('main-nav').addEventListener('click', e => { if (e.target.closest('a')) {
    menu.setAttribute('aria-expanded', 'false');
    $('main-nav').classList.remove('open');
} });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
    menu.setAttribute('aria-expanded', 'false');
    $('main-nav').classList.remove('open');
    menu.focus();
} });
document.querySelectorAll('[data-price]').forEach(button => button.addEventListener('click', () => { const key = button.dataset.price; document.querySelectorAll('[data-price]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); document.querySelectorAll('[data-offer]').forEach(article => article.classList.toggle('price-selected', article.dataset.offer === key)); $('offer').value = key; recalculate(); }));
// No cookies, persistence, analytics or outbound requests. All interactive state is page-local.
document.querySelectorAll('button:disabled').forEach(b => { if (!b.matches('[type=submit]'))
    b.disabled = false; });
updateIndustry();
recalculate();
