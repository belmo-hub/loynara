/** Home page behaviour. Everything lives in page memory: no network, no storage. The page reads without this file. */
import { SITE } from './site.js';
import { compute, euro, signedEuro } from './calc.js';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const $$ = <T extends HTMLElement = HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)];
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const STAMPS = 8;

// Menu sheet on phones.
const menuBtn = $('#menuBtn'), sheet = $('#sheet');
function setMenu(open: boolean) {
  sheet.classList.toggle('open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.setAttribute('aria-label', open ? 'Menü schließen' : 'Menü öffnen');
  if (!open) menuBtn.focus({ preventScroll: true });
}
menuBtn.addEventListener('click', () => setMenu(!sheet.classList.contains('open')));
sheet.addEventListener('click', event => { if ((event.target as Element).closest('a')) setMenu(false); });
addEventListener('keydown', event => { if (event.key === 'Escape' && sheet.classList.contains('open')) setMenu(false); });

// Hero: the visitor's tap books a stamp on the example card. The same card carries into the scene below.
const tap = $('#tap'), heroStamps = $$('#heroStamps .st'), banner = $('#heroBanner');
let stamps = 3, busy = false;
const goal = (have: number) => have < STAMPS ? `Noch ${STAMPS - have} Stempel bis zu deiner Prämie:` : 'Deine Prämie ist bereit:';
/** Restarts a CSS animation that is tied to a class. */
function replay(element: HTMLElement, name: string) { element.classList.remove(name); void element.offsetWidth; element.classList.add(name); }
tap.addEventListener('click', () => {
  if (busy) return;
  busy = true;
  if (stamps >= STAMPS) { stamps = 3; heroStamps.forEach((stamp, i) => { stamp.classList.remove('pop'); stamp.classList.toggle('on', i < 3); }); }
  tap.classList.add('done'); replay(tap, 'flash');
  banner.classList.add('show');
  setTimeout(() => {
    const stamp = heroStamps[stamps];
    stamp.style.setProperty('--rot', `${stamps % 2 ? 6 : -7}deg`);
    stamp.classList.add('on');
    if (!reduce) replay(stamp, 'pop');
    stamps++;
    $('#heroCount').textContent = `${stamps} von ${STAMPS}`;
    $('#heroGoal').textContent = goal(stamps);
    $('#tapStatus').textContent = `Beispiel: Dein Team hat bestätigt. Stempel ${stamps} von ${STAMPS} gelandet.`;
    syncScene();
    setTimeout(() => { banner.classList.remove('show'); busy = false; }, 1600);
  }, 420);
});

// Scene: four steps driven by scroll, on the hero's card. With reduced motion the steps are stacked stills (CSS).
const scene = $('#ablauf'), track = $$('.track i'), sceneStamps = $$('#sceneStamps .st'), passDots = $$('#passDots i');
let step = -1;
function syncScene(at = step) {
  const have = Math.min(STAMPS, stamps + (at >= 2 ? 1 : 0));
  sceneStamps.forEach((stamp, i) => stamp.classList.toggle('on', i < have));
  passDots.forEach((dot, i) => dot.classList.toggle('on', i < have));
  $('#sceneCount').textContent = `${have} von ${STAMPS}`;
  $('#sceneGoal').textContent = goal(have);
  return have;
}
function frame() {
  $('#top').classList.toggle('scrolled', scrollY > 8);
  if (reduce) return;
  const progress = Math.min(1, Math.max(0, -scene.getBoundingClientRect().top / (scene.offsetHeight - innerHeight)));
  const next = Math.min(3, Math.floor(progress * 4));
  if (next === step) return;
  const previous = step;
  step = next;
  scene.dataset.step = String(step);
  track.forEach((dot, i) => dot.classList.toggle('on', i <= step));
  $('#trackLabel').textContent = `${step + 1} von 4`;
  const have = syncScene(step);
  if (step === 2 && previous < 2) replay(sceneStamps[have - 1], 'pop');
}
let ticking = false;
addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; frame(); }); } }, { passive: true });
frame(); syncScene(0);

// Phone bar: shows once the hero's two buttons have left the screen (at once on short screens), hides at the close.
const bar = $('#bar');
let actsGone = innerHeight <= 700, atClose = false;
const showBar = () => bar.classList.toggle('show', actsGone && !atClose);
new IntersectionObserver(([entry]) => { actsGone = innerHeight <= 700 || (!entry.isIntersecting && entry.boundingClientRect.top < 0); showBar(); }).observe($('#mobileActs'));
new IntersectionObserver(([entry]) => { atClose = entry.isIntersecting; showBar(); }, { rootMargin: '0px 0px -30% 0px' }).observe($('#anfrage'));
showBar();

// Shop chips on phones.
const chips = $$('.chips button');
chips.forEach(chip => chip.addEventListener('click', () => {
  chips.forEach(other => other.setAttribute('aria-pressed', String(other === chip)));
  $$('.shop').forEach(shop => shop.classList.toggle('show', shop.dataset.shop === chip.dataset.shop));
}));

// Calculator: the live maths (src/calc.ts) at 26 opening days.
const visits = $<HTMLInputElement>('#k'), basket = $<HTMLInputElement>('#w'), gain = $<HTMLInputElement>('#z');
function calc(announce: boolean) {
  const k = +visits.value, w = +basket.value, z = +gain.value;
  $('#ko').textContent = String(k); $('#wo').textContent = `${w} €`; $('#zo').textContent = `${z} %`;
  visits.setAttribute('aria-valuetext', `${k} Käufe`); basket.setAttribute('aria-valuetext', `${w} €`); gain.setAttribute('aria-valuetext', `${z} %`);
  const result = compute({ visits: k, basket: w, days: 26, gain: z }, SITE.price.amount);
  const additional = euro(result.additional), net = signedEuro(result.difference);
  $('#res').textContent = additional; $('#net').textContent = net;
  if (announce) $('#calcSay').textContent = `Zusätzlicher Monatsumsatz im Beispiel: ${additional}, nach Gebühr ${net}.`;
}
$('#calcForm').addEventListener('input', () => calc(false));
$('#calcForm').addEventListener('change', () => calc(true));

// Request: prepares an e-mail the visitor sends themselves. Each action sets the wish it stands for.
const form = $<HTMLFormElement>('#rq'), shop = $<HTMLInputElement>('#rq-shop'), want = $<HTMLSelectElement>('#rq-want'), sent = $('#rq-sent');
$$('[data-want]').forEach(action => action.addEventListener('click', () => { want.value = action.dataset.want!; }));
const requestText = () => `Geschäft: ${shop.value.trim() || '-'}\nBranche: ${$<HTMLSelectElement>('#rq-type').value || '-'}\nWunsch: ${want.selectedOptions[0].text}\n\n${$<HTMLTextAreaElement>('#rq-msg').value}`;
$('#rq-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(requestText()); sent.textContent = `Text kopiert. Schicke ihn an ${SITE.supportEmail}.`; }
  catch { sent.textContent = `Kopieren hat nicht geklappt. Schreibe uns an ${SITE.supportEmail}.`; }
  form.classList.add('ok');
});
form.addEventListener('submit', event => {
  event.preventDefault();
  const name = shop.value.trim();
  form.classList.toggle('invalid', !name);
  shop.setAttribute('aria-invalid', String(!name));
  if (!name) { shop.focus(); return; }
  form.classList.add('ok');
  sent.textContent = `Falls sich nichts öffnet, kopiere den Text und schicke ihn an ${SITE.supportEmail}.`;
  location.href = `mailto:${SITE.supportEmail}?subject=${encodeURIComponent(`Anfrage: ${name}`)}&body=${encodeURIComponent(requestText())}`;
});
