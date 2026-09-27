import { getIndustries, getOffers, periodCost, euro } from './config.js';
import { initialDemo, transition, balance, canAdvance } from './demo.js';
import { demoScreens, escapeText, stamps } from './views.js';
import { parseMoney, calculate, trafficScenario, normalizeDigits } from './economics.js';
import { currentLocale, localeTag, text } from './i18n.js';
import { demoCopy, storyCopy, featureCopy, heroCopy } from './dynamic-copy.js';
const locale = currentLocale();
const t = (de, en, ar) => text(de, en, ar, locale);
const industries = getIndustries(locale), offers = getOffers(locale);
const number = (n, options = {}) => new Intl.NumberFormat(localeTag(locale), options).format(n);
const $ = (id) => document.getElementById(id);
const input = (id) => $(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let ready = false;
const panelAnimations = new WeakMap();
function animatePanel(element) {
    if (!element || !ready || reducedMotion.matches)
        return;
    panelAnimations.get(element)?.cancel();
    panelAnimations.set(element, element.animate([{ opacity: .7, translate: '0 5px' }, { opacity: 1, translate: '0 0' }], { duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)' }));
}
reducedMotion.addEventListener('change', () => { if (reducedMotion.matches)
    document.getAnimations().forEach(animation => animation.cancel()); });
let industry = (document.body.dataset.industry || 'cafe');
let state = initialDemo(industries[industry].threshold);
const storyState = { return: 0, referral: 0 };
const say = (message) => { $('demo-announcement').textContent = message; };
function changeView(next) { $('demo-screens').dataset.view = next; document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === next))); animatePanel($('demo-screens')); }
function renderDemo() {
    const x = industries[industry], n = balance(state), target = x.threshold;
    const { titles, descriptions } = demoCopy(x, locale);
    $('step-counter').textContent = t(`SCHRITT ${state.step + 1} VON 5`, `STEP ${state.step + 1} OF 5`, `الخطوة ${state.step + 1} من 5`);
    $('step-title').textContent = titles[state.step];
    $('step-description').textContent = descriptions[state.step];
    document.querySelectorAll('.step-track li').forEach((li, i) => { if (i === state.step)
        li.setAttribute('aria-current', 'step');
    else
        li.removeAttribute('aria-current'); });
    $('demo-screens').innerHTML = demoScreens(state, industry, input('business-name').value.trim(), locale);
    animatePanel($('demo-screens'));
    const next = $('demo-next');
    next.disabled = !canAdvance(state);
    next.textContent = state.step === 0 ? t('Start →', 'Start →', 'ابدأ ←') : state.step === 4 ? t('Rundgang abgeschlossen', 'Walkthrough complete', 'اكتملت الجولة') : t('Weiter →', 'Next →', 'التالي ←');
    $('demo-back').disabled = state.step === 0;
    $('step-hint').textContent = state.step === 1 && !state.enrolled ? t('Öffne zuerst die Beispielkarte in der Kundensicht.', 'First open the example card in the customer view.', 'افتح أولًا البطاقة التوضيحية في واجهة العميل.') : state.step === 3 && !state.confirmed ? t('Identifiziere die Karte und bestätige +1 in der Kassensicht.', 'Identify the card and confirm +1 in the checkout view.', 'تعرّف على البطاقة وأكد إضافة ختم في واجهة نقطة الدفع.') : state.step === 4 ? t('Du kannst die Perspektive wechseln oder spätere Besuche ansehen.', 'You can switch views or explore later visits.', 'يمكنك التبديل بين الواجهات أو استعراض الزيارات اللاحقة.') : t('Du entscheidest, wann es weitergeht.', 'You decide when to continue.', 'أنت تحدد متى تتابع.');
    const later = $('later-visits');
    later.hidden = state.step !== 4;
    later.innerHTML = state.redeemed ? `<p><strong>${t('Prämie bestätigt eingelöst.', 'Reward redemption confirmed.', 'تم تأكيد استخدام المكافأة.')}</strong> ${t(`${target} bestätigte Besuche, 1 Einlösung, 0 Stempel übrig. Die Inhaberansicht zeigt dieselbe Geschichte.`, `${target} confirmed visits, 1 redemption, 0 stamps left. The owner view shows the same history.`, `الزيارات المؤكدة: ${target}، استخدام المكافأة: 1، الأختام المتبقية: 0. تعرض واجهة صاحب النشاط السجل نفسه.`)}</p>` : state.later === target - 1 ? `<p><strong>${t(`${target} von ${target} Stempeln.`, `${target} of ${target} stamps.`, `الأختام: ${target} من ${target}.`)}</strong> ${t('Nach dem letzten bestätigten Besuch ist die Prämie verfügbar. Das Team bestätigt auch die Einlösung.', 'After the last confirmed visit, the reward is available. The team also confirms redemption.', 'تتاح المكافأة بعد الزيارة المؤكدة الأخيرة. يؤكد الفريق أيضًا استخدامها.')}</p><button class="button ink" data-action="redeem">${t('Prämie einlösen bestätigen', 'Confirm reward redemption', 'تأكيد استخدام المكافأة')}</button>` : state.later === target - 2 ? `<p><strong>${t(`Zeitsprung: ${target - 2} weitere, jeweils bestätigte Besuche.`, `Time jump: ${target - 2} more visits, each confirmed.`, `انتقال زمني: زيارات إضافية مؤكدة، عددها ${target - 2}.`)}</strong> ${t(`Der Stand ist jetzt ${target - 1}/${target}. Bestätige den nächsten Besuch selbst.`, `The balance is now ${target - 1}/${target}. Confirm the next visit yourself.`, `الرصيد الآن ${target - 1}/${target}. أكد الزيارة التالية بنفسك.`)}</p><button class="button ink" data-action="last">${t(`Besuch ${target}: +1 Stempel bestätigen`, `Visit ${target}: confirm +1 stamp`, `الزيارة ${target}: تأكيد إضافة ختم`)}</button>` : `<p><strong>${t('Was passiert beim nächsten Besuch?', 'What happens on the next visit?', 'ماذا يحدث في الزيارة التالية؟')}</strong> ${t(`Springe ausdrücklich zu ${target - 2} weiteren bestätigten Besuchen. Das ist ein Zeitraffer, kein zusätzlicher Effekt dieses Einkaufs.`, `Choose to jump ahead by ${target - 2} more confirmed visits. This fast-forwards time; it is not an additional effect of this purchase.`, `اختر الانتقال إلى زيارات مؤكدة لاحقة عددها ${target - 2}. هذا اختصار زمني، وليس أثرًا إضافيًا لعملية الشراء هذه.`)}</p><button class="button secondary" data-action="jump">${t(`Zeitsprung: ${target - 2} weitere Besuche →`, `Time jump: ${target - 2} more visits →`, `انتقال زمني: ${target - 2} من الزيارات الإضافية ←`)}</button>`;
    say(t(`Schritt ${state.step + 1}: ${titles[state.step]} Kartenstand ${n} von ${target} Stempeln.`, `Step ${state.step + 1}: ${titles[state.step]} Card balance ${n} of ${target} stamps.`, `الخطوة ${state.step + 1}: ${titles[state.step]} رصيد الأختام: ${n} من ${target}.`));
}
function resetDemo() { state = initialDemo(industries[industry].threshold); changeView('customer'); renderDemo(); storyState.return = 0; storyState.referral = 0; renderStories(); }
function focusDemoStep(keyboard) { const action = state.step === 1 && !state.enrolled ? '[data-action="enroll"]' : state.step === 3 && !state.identified ? '[data-action="identify"]' : state.step === 3 && !state.confirmed ? '[data-action="award"]' : '#step-title'; document.querySelector(action)?.focus({ preventScroll: !keyboard }); }
$('demo-next').addEventListener('click', e => { state = transition(state, 'next'); changeView(state.step === 2 || state.step === 3 ? 'cashier' : 'customer'); renderDemo(); focusDemoStep(e.detail === 0); });
$('demo-back').addEventListener('click', e => { state = transition(state, 'back'); changeView(state.step === 2 || state.step === 3 ? 'cashier' : 'customer'); renderDemo(); focusDemoStep(e.detail === 0); });
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
    $('industry-preview-name').dir = 'auto';
    $('industry-preview-name').textContent = input('business-name').value.trim() || x.name;
    $('industry-preview-threshold').textContent = String(x.threshold);
    $('industry-preview-reward').textContent = x.reward;
    document.querySelectorAll('[data-business]').forEach(el => { el.dir = 'auto'; el.textContent = input('business-name').value.trim() || x.name; });
    document.querySelectorAll('[data-reward]').forEach(el => el.textContent = t(`${x.reward} · nach ${x.threshold} Stempeln`, `${x.reward} · after ${x.threshold} stamps`, `${x.reward} · عند جمع ${x.threshold} من الأختام`));
    document.querySelectorAll('[data-industry-choice]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.industryChoice === industry)));
    $('industry-variant').hidden = true;
    $('return-industry').textContent = x.offer;
    $('referral-industry').textContent = x.referral;
    animatePanel(document.querySelector('.industry-context'));
    animatePanel(document.querySelector('.hero-card'));
    heroStage = 0;
    renderHero();
    resetDemo();
    say(t(`${x.label} ausgewählt. Demo neu gestartet. Deine Rechenwerte bleiben unverändert.`, `${x.label} selected. Demo restarted. Your calculator values are unchanged.`, `تم اختيار ${x.label}. أُعيد بدء التجربة. بقيت قيم الحاسبة كما هي.`));
}
document.querySelectorAll('[data-industry-choice]').forEach(b => b.addEventListener('click', () => { industry = b.dataset.industryChoice; updateIndustry(); }));
$('variant').addEventListener('change', () => { industry = $('variant').value; updateIndustry(); });
input('business-name').addEventListener('input', () => { const name = input('business-name').value.trim() || industries[industry].name; document.querySelectorAll('[data-business],[data-demo-business]').forEach(el => { el.dir = 'auto'; el.textContent = name; }); $('industry-preview-name').textContent = name; renderStories(); });
function renderStories() {
    const x = industries[industry];
    // Unicode isolates keep user-entered business names readable in mixed-direction text.
    const business = `\u2068${input('business-name').value.trim() || x.name}\u2069`;
    const stories = storyCopy(x, business, locale);
    const returnStages = [t('Besuchspause', 'Visit gap', 'فترة دون زيارات'), t('Zielgruppe', 'Audience', 'الجمهور المستهدف'), t('Angebotsentwurf', 'Offer draft', 'مسودة عرض'), t('Nachrichtenvorschau', 'Message preview', 'معاينة الرسالة'), t('Beispiel: Wiederkehr', 'Example: return visit', 'مثال: عودة العميل')];
    for (const key of ['return', 'referral']) {
        const idx = storyState[key], s = stories[key][idx];
        $(`${key}-flow`).dataset.stage = String(idx);
        $(`${key}-flow`).innerHTML = `<div class="story-visual" aria-hidden="true">${key === 'return' ? `<span class="story-member" dir="ltr">A-01</span><span class="story-connector">${t('→', '→', '←')}</span><span class="story-token">${returnStages[idx]}</span>` : `<span class="story-member" dir="ltr">R-01</span><span class="story-connector">${t('→', '→', '←')}</span><span class="story-member" dir="ltr">R-02</span><span class="story-token">${idx === 3 ? t('+1 Bonus bestätigt', '+1 bonus confirmed', 'تم تأكيد ختم إضافي') : t('0 Bonusstempel', '0 bonus stamps', 'الأختام الإضافية: 0')}</span>`}</div><span>${s[0]}</span><h3>${s[1]}</h3><p>${escapeText(s[2])}</p>`;
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
    document.querySelectorAll('[data-price],[data-traffic-price]').forEach(button => button.setAttribute('aria-pressed', String((button.dataset.price || button.dataset.trafficPrice) === offer)));
    document.querySelectorAll('[data-offer]').forEach(article => article.classList.toggle('price-selected', article.dataset.offer === offer));
    $('fee').textContent = euro(fee);
    $('period-label').textContent = period === 'first' ? t('Erster Monat inklusive Einrichtung', 'First month including setup', 'الشهر الأول شامل الإعداد') : t('Monatliche Softwaregebühr', 'Monthly software fee', 'رسوم البرنامج الشهرية');
    recalculateTraffic(false);
    $('assumption-label').textContent = examples ? t('Beispielannahmen geladen. Änderungen sind deine Annahmen, keine Prognose. Alle Werte bleiben auf dieser Seite.', 'Example assumptions loaded. Changes are your assumptions, not a forecast. All values stay on this page.', 'تم تحميل افتراضات توضيحية. التعديلات هي افتراضاتك وليست توقعات. تبقى جميع القيم في هذه الصفحة.') : t('Deine Eingaben bleiben auf dieser Seite und werden nicht übertragen.', 'Your entries stay on this page and are not transmitted.', 'تبقى مدخلاتك في هذه الصفحة ولا يتم إرسالها.');
    $('calc-error').textContent = '';
    for (const id of ['contribution', 'rewards', 'effort', 'revenue', 'visits'])
        input(id).removeAttribute('aria-invalid');
    try {
        const read = (id) => { try {
            return parseMoney(input(id).value, locale);
        }
        catch (e) {
            input(id).setAttribute('aria-invalid', 'true');
            throw e;
        } };
        const m = read('contribution'), b = read('rewards'), h = read('effort'), r = read('revenue'), rawN = normalizeDigits(input('visits').value.trim());
        for (const [id, v] of [['rewards', b], ['effort', h], ['revenue', r]])
            if (v !== null && v < 0) {
                input(id).setAttribute('aria-invalid', 'true');
                throw new Error(t('Prämienkosten, Betriebsaufwand und Umsatz dürfen nicht negativ sein.', 'Reward costs, operating effort and revenue must not be negative.', 'يجب ألا تكون تكاليف المكافآت والتشغيل والإيرادات سالبة.'));
            }
        let n = null;
        if (rawN) {
            if (!/^\d+$/.test(rawN) || Number(rawN) > 100000) {
                input('visits').setAttribute('aria-invalid', 'true');
                throw new Error(t('Bitte 0 bis 100.000 ganze zusätzliche Besuche eingeben.', 'Enter a whole number of additional visits between 0 and 100,000.', 'أدخل عددًا صحيحًا للزيارات الإضافية بين 0 و100,000.'));
            }
            n = Number(rawN);
        }
        const result = calculate(fee, m, b, h, n, r, locale);
        $('required').textContent = result.required === null ? '–' : number(result.required);
        const frequency = result.required !== null && result.required > 0 ? number(result.required <= 30 ? 30 / result.required : result.required / 30, { maximumFractionDigits: 1 }) : '';
        $('visit-frequency').textContent = result.required !== null && result.required > 0 && period === 'recurring' ? result.required <= 30 ? t(`≈ ein zusätzlicher Besuch alle ${frequency} Tage (30-Tage-Monat)`, `≈ one additional visit every ${frequency} days (30-day month)`, `≈ زيارة إضافية واحدة كل ${frequency} يوم (شهر من 30 يومًا)`) : t(`≈ ${frequency} zusätzliche Besuche pro Tag (30-Tage-Monat)`, `≈ ${frequency} additional visits per day (30-day month)`, `≈ عدد الزيارات الإضافية يوميًا: ${frequency} (شهر من 30 يومًا)`) : '';
        $('required').classList.toggle('compact-number', String(result.required ?? '').length > 5);
        $('required-label').textContent = result.required === 1 ? t('zusätzlicher Besuch', 'additional visit', 'زيارة إضافية') : t('zusätzliche Besuche', 'additional visits', 'زيارات إضافية');
        const scope = result.complete ? t('Mit allen angegebenen Kosten', 'With all specified costs', 'مع جميع التكاليف المدخلة') : t('Untergrenze mit den bisher angegebenen Kosten', 'Lower bound using the costs entered so far', 'الحد الأدنى باستخدام التكاليف المدخلة حتى الآن');
        $('result-explanation').textContent = m === null ? t('Trage deinen geschätzten Beitrag je zusätzlichem Besuch ein.', 'Enter your estimated contribution per additional visit.', 'أدخل المساهمة المقدرة لكل زيارة إضافية.') : m <= 0 ? t('Kein endlicher Kostenausgleich: Wenn je zusätzlichem Besuch nichts oder weniger als null übrig bleibt, decken weitere Besuche die Fixkosten nicht.', 'No finite break-even point: if each additional visit leaves zero or a negative contribution, further visits cannot cover the fixed costs.', 'لا توجد نقطة تعادل محددة: إذا كانت مساهمة كل زيارة إضافية صفرًا أو سالبة، فلن تغطي الزيارات الإضافية التكاليف الثابتة.') : t(`${scope}: ${euro(result.cost)} ÷ ${euro(m)}, auf ganze Besuche aufgerundet.`, `${scope}: ${euro(result.cost)} ÷ ${euro(m)}, rounded up to whole visits.`, `${scope}: \u2066${euro(result.cost)} ÷ ${euro(m)}\u2069، مع التقريب لأعلى إلى عدد صحيح من الزيارات.`);
        let caveat = result.complete ? t('Berücksichtigt die gewählten Software-/Einrichtungskosten und die von dir angegebenen zusätzlichen Prämien- und Betriebskosten.', 'Includes the selected software/setup costs and the additional reward and operating costs you entered.', 'يشمل تكاليف البرنامج والإعداد المختارة وتكاليف المكافآت والتشغيل الإضافية التي أدخلتها.') : b === null && h === null ? (period === 'first' ? t('Deckt zunächst nur Einrichtung und ersten Monat. Weitere Programm- und Betriebskosten sind noch nicht berücksichtigt.', 'Initially covers setup and the first month only. Further programme and operating costs are not yet included.', 'يغطي مبدئيًا الإعداد والشهر الأول فقط. لم تُحتسب بعد تكاليف برنامج الولاء والتشغيل الأخرى.') : t('Deckt zunächst nur die monatliche Softwaregebühr. Weitere Programm- und Betriebskosten sind noch nicht berücksichtigt.', 'Initially covers the monthly software fee only. Further programme and operating costs are not yet included.', 'يغطي مبدئيًا رسوم البرنامج الشهرية فقط. لم تُحتسب بعد تكاليف برنامج الولاء والتشغيل الأخرى.')) : t('Unvollständige Kostenannahme: Ein leeres Kostenfeld ist unbekannt, nicht bestätigte 0 €. Das Ergebnis ist eine Untergrenze.', 'Incomplete cost assumptions: a blank cost field is unknown, not a confirmed €0. The result is a lower bound.', 'افتراضات التكاليف غير مكتملة: حقل التكلفة الفارغ يعني قيمة غير معروفة، وليس صفر يورو مؤكدًا. تمثل النتيجة حدًا أدنى.');
        if (offers[offer].draft)
            caveat = t('Privater Paketentwurf, nicht freigegeben. ', 'Private package draft, not approved. ', 'مسودة باقة خاصة، غير معتمدة. ') + caveat;
        $('cost-caveat').textContent = caveat;
        $('scenario').hidden = n === null;
        $('scenario-revenue').textContent = result.revenue === null ? t('Umsatz fehlt', 'Revenue missing', 'الإيرادات غير مدخلة') : euro(result.revenue);
        $('scenario-change').textContent = result.change === null ? t('Angaben fehlen', 'Missing inputs', 'مدخلات ناقصة') : euro(result.change);
        $('scenario-change').classList.toggle('negative', result.change !== null && result.change < 0);
    }
    catch (e) {
        $('visit-frequency').textContent = '';
        $('calc-error').textContent = e instanceof Error ? e.message : t('Bitte die Eingaben prüfen.', 'Please check your entries.', 'يرجى مراجعة المدخلات.');
        $('required').textContent = '–';
        $('result-explanation').textContent = t('Bitte die markierten Eingaben prüfen.', 'Please check the marked entries.', 'يرجى مراجعة المدخلات المحددة.');
        $('scenario').hidden = true;
        $('cost-caveat').textContent = t('Es wird kein Ergebnis aus ungültigen Eingaben angezeigt.', 'No result is shown for invalid entries.', 'لا تُعرض نتيجة لمدخلات غير صالحة.');
    }
    announceCalculation('calculator');
}
$('calculator').addEventListener('submit', e => e.preventDefault());
$('calculator').addEventListener('input', recalculate);
$('calculator').addEventListener('change', recalculate);
$('calculator').addEventListener('reset', () => { examples = false; requestAnimationFrame(recalculate); });
$('load-example').addEventListener('click', () => { examples = true; for (const [id, v] of Object.entries({ contribution: '8', rewards: '20', effort: '10', revenue: '18', visits: '10' }))
    input(id).value = v; $('calc-details').open = true; recalculate(); });
$('use-draft').addEventListener('click', () => { $('offer').value = 'introDraft'; $('period').value = 'first'; recalculate(); $('rechner').scrollIntoView(); $('offer').focus({ preventScroll: true }); });
const trafficIds = ['traffic-customers', 'traffic-basket', 'traffic-days', 'traffic-uplift'];
function recalculateTraffic(announce = true) { updateTrafficResults(); if (announce)
    announceCalculation('traffic-form'); }
function updateTrafficResults() {
    const offer = $('offer').value;
    $('traffic-fee').textContent = euro(offers[offer].monthly);
    document.querySelectorAll('[data-traffic-price]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.trafficPrice === offer)));
    $('traffic-error').textContent = '';
    for (const id of trafficIds)
        input(id).removeAttribute('aria-invalid');
    const clear = () => { for (const id of ['traffic-monthly-revenue', 'traffic-after-fee', 'traffic-ratio', 'traffic-annual'])
        $(id).textContent = '–'; };
    if (trafficIds.some(id => input(id).value.trim() === '')) {
        clear();
        return;
    }
    try {
        const integer = (id, min, max) => { const raw = normalizeDigits(input(id).value.trim()); if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
            input(id).setAttribute('aria-invalid', 'true');
            throw new Error(t(`Bitte ${min} bis ${max} als ganze Zahl eingeben.`, `Enter a whole number between ${min} and ${max}.`, `أدخل عددًا صحيحًا بين ${min} و${max}.`));
        } return Number(raw); };
        const customers = integer('traffic-customers', 0, 500), days = integer('traffic-days', 1, 31), uplift = integer('traffic-uplift', 0, 20);
        let basket;
        try {
            basket = parseMoney(input('traffic-basket').value, locale);
        }
        catch (e) {
            input('traffic-basket').setAttribute('aria-invalid', 'true');
            throw e;
        }
        if (basket === null || basket < 0 || basket > 50_000) {
            input('traffic-basket').setAttribute('aria-invalid', 'true');
            throw new Error(t('Bitte einen Bon von 0 bis 500 € eingeben.', 'Enter an average spend from €0 to €500.', 'أدخل متوسط إنفاق بين 0 و500 يورو.'));
        }
        const result = trafficScenario(customers, basket, days, uplift, offers[offer].monthly, locale);
        $('traffic-monthly-revenue').textContent = euro(result.monthlyRevenue);
        $('traffic-after-fee').textContent = euro(result.revenueLessFee);
        $('traffic-ratio').textContent = `${number(result.revenueToFee)}×`;
        $('traffic-annual').textContent = euro(result.annualRevenueLessFees);
        $('traffic-after-fee').classList.toggle('negative', result.revenueLessFee < 0);
        $('traffic-annual').classList.toggle('negative', result.annualRevenueLessFees < 0);
    }
    catch (e) {
        clear();
        $('traffic-error').textContent = e instanceof Error ? e.message : t('Bitte die Eingaben prüfen.', 'Please check your entries.', 'يرجى مراجعة المدخلات.');
    }
}
function syncTrafficRange(id) {
    let numeric;
    try {
        numeric = id === 'traffic-basket' ? (parseMoney(input(id).value, locale) ?? 0) / 100 : Number(normalizeDigits(input(id).value));
    }
    catch {
        numeric = NaN;
    }
    const range = input(`${id}-range`);
    range.value = String(Number.isFinite(numeric) ? Math.max(Number(range.min), Math.min(Number(range.max), numeric)) : Number(range.min));
    range.style.setProperty('--range-fill', `${(Number(range.value) - Number(range.min)) / (Number(range.max) - Number(range.min)) * 100}%`);
}
for (const id of trafficIds) {
    input(id).addEventListener('input', () => { syncTrafficRange(id); $('traffic-assumption').textContent = t('Deine Annahmen, kein erwarteter Loynara-Effekt. Diese Werte bleiben auf dieser Seite.', 'Your assumptions, not an expected Loynara effect. These values stay on this page.', 'هذه افتراضاتك وليست أثرًا متوقعًا لـ Loynara. تبقى هذه القيم في هذه الصفحة.'); recalculateTraffic(); });
    input(`${id}-range`).addEventListener('input', () => { input(id).value = input(`${id}-range`).value; syncTrafficRange(id); $('traffic-assumption').textContent = t('Deine Annahmen, kein erwarteter Loynara-Effekt. Diese Werte bleiben auf dieser Seite.', 'Your assumptions, not an expected Loynara effect. These values stay on this page.', 'هذه افتراضاتك وليست أثرًا متوقعًا لـ Loynara. تبقى هذه القيم في هذه الصفحة.'); recalculateTraffic(); });
}
$('traffic-form').addEventListener('submit', e => e.preventDefault());
$('traffic-form').addEventListener('reset', () => { requestAnimationFrame(() => { for (const id of trafficIds) {
    input(id).value = '';
    syncTrafficRange(id);
} $('traffic-assumption').textContent = t('Keine Werte vorausgefüllt. Gib deine Annahmen ein oder stelle ein sichtbar gekennzeichnetes Beispiel wieder her. 0 % ist möglich.', 'No values are prefilled. Enter your assumptions or restore a clearly labelled example. 0% is allowed.', 'لا توجد قيم معبأة مسبقًا. أدخل افتراضاتك أو استعد مثالًا موضحًا بوضوح. يمكن اختيار 0%.'); recalculateTraffic(); }); });
$('traffic-sample').addEventListener('click', () => { for (const [id, value] of Object.entries({ 'traffic-customers': '50', 'traffic-basket': '70', 'traffic-days': '26', 'traffic-uplift': '10' })) {
    input(id).value = value;
    syncTrafficRange(id);
} $('traffic-assumption').textContent = t('Beispielrechnung: 50 Kunden/Tag, 70 € Bon, 26 Tage, 10 % zusätzlich. Kein erwarteter Loynara-Effekt. Änderungen sind deine Annahmen.', 'Example calculation: 50 customers/day, €70 average spend, 26 days, 10% additional activity. Not an expected Loynara effect. Changes are your assumptions.', 'حساب توضيحي: 50 عميلًا يوميًا، ومتوسط إنفاق 70 يورو، و26 يومًا، وزيادة 10%. ليس أثرًا متوقعًا لـ Loynara. التعديلات تمثل افتراضاتك.'); recalculateTraffic(); });
document.querySelectorAll('[data-traffic-price]').forEach(button => button.addEventListener('click', () => { $('offer').value = button.dataset.trafficPrice; recalculate(); announceCalculation('traffic-form'); }));
const features = featureCopy(locale);
let featureRequest = 0, loadedFeature = 'programme';
document.querySelectorAll('[data-feature]').forEach(b => b.addEventListener('click', async () => {
    const request = ++featureRequest, key = b.dataset.feature, f = features[key];
    document.querySelectorAll('[data-feature]').forEach(v => v.setAttribute('aria-pressed', String(v === b)));
    const panel = document.querySelector('.product-capture');
    panel.setAttribute('aria-busy', 'true');
    const prepared = new Image();
    prepared.src = `/assets/${f.src}`;
    try {
        await prepared.decode();
        if (request !== featureRequest)
            return;
        const img = $('feature-image');
        img.src = prepared.src;
        img.alt = f.alt;
        loadedFeature = key;
        $('feature-caption').textContent = f.caption;
        $('feature-detail').innerHTML = `<strong>${f.status}</strong><p>${f.detail}</p>`;
        animatePanel(img);
        animatePanel($('feature-detail'));
    }
    catch {
        if (request !== featureRequest)
            return;
        document.querySelectorAll('[data-feature]').forEach(v => v.setAttribute('aria-pressed', String(v.dataset.feature === loadedFeature)));
        $('feature-caption').textContent = t('Diese Ansicht konnte nicht geladen werden. Bitte erneut auswählen.', 'This view could not be loaded. Please select it again.', 'تعذر تحميل هذه الواجهة. يرجى اختيارها مرة أخرى.');
    }
    finally {
        if (request === featureRequest)
            panel.removeAttribute('aria-busy');
    }
}));
$('contact-draft').addEventListener('submit', e => e.preventDefault());
$('download-brief').addEventListener('click', () => { const business = input('contact-business').value.trim() || input('business-name').value.trim() || industries[industry].name; const content = t(`Loynara – Gesprächsnotiz (lokal erstellt, nicht gesendet)\n\nGeschäft: ${business}\nBereich: ${industries[industry].label}\nKontakt (optional): ${input('contact-email').value.trim()}\n\nMeine Fragen:\n${$('contact-question').value}\n\nPreisvorschläge und Vertragsbedingungen vor einer Bestellung abstimmen.\n`, `Loynara – conversation note (created locally, not sent)\n\nBusiness: ${business}\nIndustry: ${industries[industry].label}\nContact (optional): ${input('contact-email').value.trim()}\n\nMy questions:\n${$('contact-question').value}\n\nAgree proposed prices and contract terms before placing an order.\n`, `Loynara – ملاحظات للمحادثة (أُنشئت محليًا ولم تُرسل)\n\nالنشاط: \u2068${business}\u2069\nالمجال: ${industries[industry].label}\nبيانات الاتصال (اختيارية): \u2068${input('contact-email').value.trim()}\u2069\n\nأسئلتي:\n${$('contact-question').value}\n\nيجب الاتفاق على الأسعار المقترحة وشروط العقد قبل تقديم طلب.\n`); const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = t('loynara-gespraechsnotiz.txt', 'loynara-conversation-note.txt', 'loynara-ملاحظات-المحادثة.txt'); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); $('brief-status').textContent = t('Notiz lokal heruntergeladen. Keine Anfrage versendet.', 'Note downloaded locally. No enquiry was sent.', 'تم تنزيل الملاحظات محليًا. لم يُرسل أي استفسار.'); });
let heroStage = 0;
function renderHero() {
    const target = industries[industry].threshold, count = heroStage === 0 ? 0 : heroStage === 3 ? 2 : 1;
    const copy = heroCopy(locale);
    $('hero-stamps').innerHTML = stamps(count, target);
    $('hero-balance').innerHTML = `${count}<small> / ${target} ${t('Stempel', 'stamps', 'أختام')}</small>`;
    $('hero-remaining').textContent = t(`Noch ${target - count} bis zur Prämie`, `${target - count} more to your reward`, `الأختام المتبقية للمكافأة: ${target - count}`);
    $('hero-owner-count').textContent = String(count);
    $('hero-activity').textContent = count === 0 ? t('Noch keine bestätigte Aktivität', 'No confirmed activity yet', 'لا يوجد نشاط مؤكد بعد') : t(`${count} bestätigte Beispielbesuche`, `${count} confirmed example ${count === 1 ? 'visit' : 'visits'}`, `الزيارات التوضيحية المؤكدة: ${count}`);
    $('hero-confirm-title').textContent = copy.titles[heroStage];
    $('hero-confirm-copy').textContent = copy.descriptions[heroStage];
    $('hero-play').textContent = copy.actions[heroStage];
    document.querySelectorAll('.hero-stage-dots span').forEach((el, i) => { if (i === heroStage)
        el.setAttribute('aria-current', 'step');
    else
        el.removeAttribute('aria-current'); });
    document.querySelector('.hero-scene').dataset.stage = String(heroStage);
}
$('hero-play').addEventListener('click', () => { heroStage = (heroStage + 1) % 4; renderHero(); animatePanel(document.querySelector('.hero-confirm')); animatePanel(document.querySelector('.hero-owner')); $('hero-announcement').textContent = `${$('hero-confirm-title').textContent} ${$('hero-balance').textContent}`; });
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
document.querySelectorAll('[data-price]').forEach(button => button.addEventListener('click', () => { $('offer').value = button.dataset.price; recalculate(); }));
// Indicators follow the selected control without delaying its action or changing page position.
for (const selector of ['.industry-options', '.view-options', '.price-switch']) {
    const group = document.querySelector(selector);
    const indicator = document.createElement('span');
    indicator.className = 'selection-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    group.prepend(indicator);
    group.dataset.indicator = 'true';
    const position = () => { const selected = group.querySelector('button[aria-pressed="true"]'); indicator.hidden = !selected; if (!selected)
        return; indicator.style.width = `${selected.offsetWidth}px`; indicator.style.height = `${selected.offsetHeight}px`; indicator.style.transform = `translate(${selected.offsetLeft}px,${selected.offsetTop}px)`; };
    new MutationObserver(position).observe(group, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
    new ResizeObserver(position).observe(group);
    document.fonts.ready.then(position);
    position();
}
let calculationAnnouncement;
function announceCalculation(id) {
    if (!ready)
        return;
    clearTimeout(calculationAnnouncement);
    calculationAnnouncement = setTimeout(() => {
        const error = $(id === 'traffic-form' ? 'traffic-error' : 'calc-error').textContent;
        const revenue = $('traffic-monthly-revenue').textContent, afterFee = $('traffic-after-fee').textContent;
        const scenarioRevenue = $('scenario-revenue').textContent, scenarioChange = $('scenario-change').textContent;
        $('calculation-announcement').textContent = error || (id === 'traffic-form'
            ? revenue === '–' ? t('Bitte alle vier Annahmen angeben.', 'Please enter all four assumptions.', 'يرجى إدخال الافتراضات الأربعة كلها.') : t(`${revenue} zusätzlicher Monatsumsatz im Rechenbeispiel. ${afterFee} nach Softwaregebühr, vor weiteren Kosten.`, `${revenue} additional monthly revenue in the example calculation. ${afterFee} after the software fee, before other costs.`, `إيرادات شهرية إضافية في المثال الحسابي: ${revenue}. المتبقي بعد رسوم البرنامج وقبل التكاليف الأخرى: ${afterFee}.`)
            : `${$('required').textContent} ${$('required-label').textContent}. ${$('result-explanation').textContent}${$('scenario').hidden ? '' : t(` Szenario: ${scenarioRevenue} zusätzlicher Umsatz. ${scenarioChange} geschätzte Beitragsänderung nach angegebenen Kosten.`, ` Scenario: ${scenarioRevenue} additional revenue. ${scenarioChange} estimated contribution change after the specified costs.`, ` السيناريو: إيرادات إضافية بقيمة ${scenarioRevenue}. التغير المقدر في المساهمة بعد التكاليف المدخلة: ${scenarioChange}.`)}`);
    }, 300);
}
// Content is always visible. Entrances are brief enhancements, never a loading gate.
if ('IntersectionObserver' in window) {
    const reveal = new IntersectionObserver(entries => { for (const entry of entries)
        if (entry.isIntersecting) {
            animatePanel(entry.target);
            reveal.unobserve(entry.target);
        } }, { threshold: .12 });
    document.querySelectorAll('.section-heading,.contrast-table,.industry-context,.demo-shell,.traffic-calculator,.value-layout,.setup-list,.offer-grid,.tap-object').forEach(el => reveal.observe(el));
}
// No cookies, persistence, analytics or outbound requests. All interactive state is page-local.
document.querySelectorAll('button:disabled').forEach(b => { if (!b.matches('[type=submit]'))
    b.disabled = false; });
updateIndustry();
recalculate();
trafficIds.forEach(syncTrafficRange);
ready = true;
