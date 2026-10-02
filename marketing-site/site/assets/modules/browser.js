import { SITE, industries, isIndustryKey } from './site.js';
import { initialDemo, transition, canAdvance, STEPS } from './demo.js';
import { buildRequest } from './request.js';
import { demoScreens, escapeText, STEP_TITLES, stepDescription } from './views.js';
const $ = (selector) => document.querySelector(selector);
const announce = (message) => { const node = $('#demo-announcement'); if (node)
    node.textContent = message; };
// ---- navigation ------------------------------------------------------------------------------------------------
const toggle = $('#menu-toggle'), nav = $('#main-nav');
if (toggle && nav) {
    const setOpen = (open) => { toggle.setAttribute('aria-expanded', String(open)); nav.classList.toggle('open', open); };
    toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
    nav.addEventListener('click', event => { if (event.target.closest('a'))
        setOpen(false); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape')
        setOpen(false); });
}
// ---- industry selector + product demo --------------------------------------------------------------------------
let industry = 'cafe';
let state = initialDemo(industries[industry].threshold);
let focusTarget = null;
function renderIndustry() {
    const x = industries[industry];
    document.body.dataset.industry = industry;
    document.querySelectorAll('[data-industry-choice]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.industryChoice === industry)));
    const panel = $('#industry-panel');
    if (panel)
        panel.innerHTML = `<h3>${escapeText(x.name)}</h3><p>${escapeText(x.intro)}</p><dl><div><dt>Das zählt als Stempel</dt><dd>${escapeText(x.visit)}</dd></div><div><dt>Prämie</dt><dd>${escapeText(x.reward)} nach ${x.threshold} Stempeln</dd></div><div><dt>Empfehlung</dt><dd>${escapeText(x.referral)}</dd></div></dl>`;
}
function renderDemo() {
    const screens = $('#demo-screens'), counter = $('#step-counter'), title = $('#step-title'), description = $('#step-description');
    if (!screens)
        return;
    screens.innerHTML = demoScreens(state, industry);
    if (counter)
        counter.textContent = `Schritt ${state.step + 1} von ${STEPS}`;
    if (title)
        title.textContent = STEP_TITLES[state.step];
    if (description)
        description.textContent = stepDescription(state, industry);
    document.querySelectorAll('#step-track li').forEach((li, i) => { li.toggleAttribute('aria-current', i === state.step); li.classList.toggle('done', i < state.step); if (i === state.step)
        li.setAttribute('aria-current', 'step'); });
    const back = $('#demo-back'), next = $('#demo-next');
    if (back)
        back.disabled = state.step === 0;
    if (next) {
        next.disabled = !canAdvance(state);
        next.hidden = state.step === STEPS - 1;
    }
    if (focusTarget) {
        screens.querySelector(focusTarget)?.focus();
        focusTarget = null;
    }
}
function act(action) {
    const before = state;
    state = transition(state, action);
    if (state === before)
        return;
    if (action === 'next' || action === 'back') {
        focusTarget = null;
        $('#step-title')?.focus();
    }
    renderDemo();
    const messages = { nfc: 'NFC-Tap gewählt.', qr: 'QR-Code gewählt.', enroll: 'Karte erstellt.', scan: 'Karte erkannt, Anfrage offen.', confirm: 'Besuch bestätigt, ein Stempel vergeben.', more: 'Weitere Besuche simuliert, Prämie verfügbar.', redeem: 'Prämie eingelöst.', reset: 'Demo zurückgesetzt.' };
    announce(messages[action] ?? `Schritt ${state.step + 1} von ${STEPS}: ${STEP_TITLES[state.step]}`);
}
function chooseIndustry(key) {
    industry = key;
    state = initialDemo(industries[key].threshold);
    renderIndustry();
    renderDemo();
    announce(`${industries[key].label} gewählt. Die Demo beginnt von vorn.`);
}
document.querySelectorAll('[data-industry-choice]').forEach(button => {
    button.disabled = false;
    button.addEventListener('click', () => { const key = button.dataset.industryChoice; if (isIndustryKey(key))
        chooseIndustry(key); });
});
$('#demo-screens')?.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (button)
        act(button.dataset.action);
});
$('#demo-next')?.addEventListener('click', () => act('next'));
$('#demo-back')?.addEventListener('click', () => act('back'));
$('#demo-reset')?.addEventListener('click', () => act('reset'));
document.querySelectorAll('#demo-controls button').forEach(button => { button.disabled = false; });
renderIndustry();
renderDemo();
// ---- demo request: prepares an e-mail; nothing is sent from this page --------------------------------------------
const form = $('#request-form');
if (form) {
    const status = $('#request-status'), copy = $('#request-copy');
    const fields = () => {
        const value = (id) => $(`#${id}`)?.value ?? '';
        return { business: value('req-business'), industry: value('req-industry'), locations: value('req-locations'), name: value('req-name'), phone: value('req-phone'), message: value('req-message') };
    };
    form.addEventListener('submit', event => {
        event.preventDefault();
        const request = buildRequest(fields());
        if (!request) {
            if (status) {
                status.setAttribute('role', 'alert');
                status.textContent = 'Bitte gib den Namen deines Geschäfts an.';
            }
            $('#req-business')?.focus();
            return;
        }
        if (status) {
            status.setAttribute('role', 'status');
            status.textContent = `Dein E-Mail-Programm öffnet eine Nachricht an ${SITE.supportEmail}. Gesendet ist noch nichts: Bitte prüfe den Text und klicke dort auf „Senden“. Öffnet sich nichts, kopiere den Text und schreib uns direkt.`;
        }
        if (copy)
            copy.hidden = false;
        window.location.href = request.mailto;
    });
    copy?.addEventListener('click', async () => {
        const request = buildRequest(fields());
        if (!request)
            return;
        try {
            await navigator.clipboard.writeText(`An: ${SITE.supportEmail}\nBetreff: ${request.subject}\n\n${request.body}`);
            if (status)
                status.textContent = `Text kopiert. Füge ihn in eine E-Mail an ${SITE.supportEmail} ein.`;
        }
        catch {
            if (status)
                status.textContent = `Kopieren war nicht möglich. Schreib uns bitte direkt an ${SITE.supportEmail}.`;
        }
    });
}
