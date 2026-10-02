import { DEMO, industries, type IndustryKey } from './site.js';
import { viewOf, type DemoState, type DemoView, type Identity } from './demo.js';

export const escapeText = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const mark = '<img src="/assets/loynara-mark.svg" width="22" height="22" alt="">';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The guide is derived from the demo state (never from scroll position). Only the current step shows its explanation. */
export const GUIDE_TITLES = ['Der Kunde öffnet seine Karte', 'Dein Team bestätigt den Besuch', 'Fortschritt und Überblick', 'Die Prämie wird eingelöst'] as const;
export function guideBody(step: number, identity: Identity): string {
  if (step === 0) return 'Ein Tap am NFC-Schild oder ein Scan des QR-Codes öffnet die Karte im Browser. Neue Kunden erstellen sie dabei, bekannte Kunden sehen sofort ihren Stand.';
  if (step === 1) return 'Die Anfrage erscheint an der Kasse. Erst mit „Besuch bestätigen“ wird ein Stempel vergeben – genau einmal.';
  if (step === 2) return identity === 'new' ? 'Die neue Karte steht jetzt bei 1 von 10: Der Fortschritt beginnt mit dem ersten bestätigten Besuch. In deiner Übersicht steht derselbe Besuch.' : 'Die Karte zeigt, wie nah die Prämie ist. In deiner Übersicht steht derselbe bestätigte Besuch.';
  return identity === 'new' ? 'Eine neue Karte braucht zehn bestätigte Besuche. Das Einlösen siehst du an einer Bestandskarte.' : 'Bei vollem Stand löst dein Team die Prämie ein. Die Karte beginnt wieder bei null, die Einlösung steht in der Übersicht.';
}
export function guideState(i: number, s: DemoState): 'done' | 'now' | 'todo' | 'later' {
  const v = viewOf(s);
  if (s.identity === 'new' && i === 3) return s.phase === 'confirmed' ? 'later' : 'todo';
  if (s.phase === 'redeemed') return 'done';
  return i < v.guideStep ? 'done' : i === v.guideStep ? 'now' : 'todo';
}
export const GUIDE_LABEL = { done: 'Erledigt', now: 'Jetzt', todo: 'Offen', later: 'Mit Bestandskarte' } as const;

export function guideHtml(s: DemoState): string {
  const v = viewOf(s);
  return GUIDE_TITLES.map((t, i) => {
    const st = guideState(i, s), current = i === v.guideStep;
    return `<li data-step="${i}" class="${current ? 'is-current' : ''}"${current ? ' aria-current="step"' : ''}><span class="guide-n">${i + 1}</span><div><h3>${t}</h3><p class="guide-body">${guideBody(i, s.identity)}</p><span class="guide-state" data-state="${st}">${GUIDE_LABEL[st]}</span></div></li>`;
  }).join('');
}

/** Ten stamps in two rows. */
export function stamps(balance: number, threshold: number): string {
  return Array.from({ length: threshold }, (_, i) => `<span class="stamp${i < balance ? ' filled' : ''}" aria-hidden="true">${i < balance ? '✓' : i + 1}</span>`).join('');
}

function card(view: DemoView, key: IndustryKey): string {
  const x = industries[key];
  const label = view.rewardReady ? 'Prämie verfügbar' : view.remaining === 1 ? 'Noch ein Besuch bis zur Prämie' : view.balance === 0 ? 'Neuer Stand' : `Noch ${view.remaining} bis zur Prämie`;
  return `<div class="loy-card"><div class="loy-top">${mark}<span>${escapeText(x.name)}</span></div><p class="loy-reward">${escapeText(cap(x.reward))} · ab ${view.threshold} Stempeln</p><div class="stamp-grid" data-stamps>${stamps(view.balance, view.threshold)}</div><div class="loy-total"><strong data-balance>${view.balance}<small> / ${view.threshold}</small></strong><span data-card-status>${label}</span></div></div>`;
}

type Mode = { interactive: boolean };
const withNext = (html: string) => html.replace('<button ', '<button data-next ');

export function customerPanel(s: DemoState, key: IndustryKey, mode: Mode): string {
  const x = industries[key], v = viewOf(s), btn = (action: string, text: string, cls = 'secondary') => mode.interactive ? `<button type="button" class="button ${cls}" data-action="${action}">${text}</button>` : '';
  let body: string;
  switch (s.phase) {
    case 'start':
      body = `<div class="choice"><p class="choice-title">Welche Karte öffnet dein Kunde?</p><div class="segmented" role="group" aria-label="Kartentyp"><button type="button" data-action="identity-returning" aria-pressed="${s.identity === 'returning'}">Bestandskarte<small>8 von 10</small></button><button type="button" data-action="identity-new" aria-pressed="${s.identity === 'new'}">Neue Karte<small>0 von 10</small></button></div><p class="note">${s.identity === 'new' ? 'Ein neuer Kunde erstellt seine Karte beim ersten Besuch – ohne Vorgeschichte.' : 'Ein Beispielkunde mit bereits gesammelten Stempeln.'}</p><div class="choice-buttons"><button type="button" class="button primary" data-action="open-nfc" data-next>Schild antippen (NFC)</button><button type="button" class="button secondary" data-action="open-qr">QR-Code scannen</button></div></div>`;
      break;
    case 'enroll':
      body = `<div class="choice"><p class="choice-title">Willkommen bei ${escapeText(x.name)}</p><p class="note">Die Karte entsteht in wenigen Sekunden – ohne App. Sie startet bei 0 von ${DEMO.threshold}: Der Fortschritt beginnt mit dem ersten bestätigten Besuch.</p>${withNext(btn('enroll', 'Karte erstellen', 'primary'))}</div>`;
      break;
    case 'request': case 'request2':
      body = `${card(v, key)}<p class="status" role="status">Besuch gemeldet – dein Team bestätigt gleich.</p>`; break;
    case 'confirmed':
      body = `${card(v, key)}<p class="status ok">✓ Stempel erhalten.</p>${s.identity === 'returning' ? withNext(btn('nextVisit', 'Nächsten Besuch zeigen')) : withNext(btn('use-returning', 'Mit Bestandskarte weiter ausprobieren'))}`; break;
    case 'reward':
      body = `${card(v, key)}<p class="status ok">Zeig dein Handy an der Kasse – dein Team löst die Prämie ein.</p>`; break;
    case 'redeemed':
      body = `${card(v, key)}<p class="status ok">✓ Prämie eingelöst. Auf zur nächsten!</p>`; break;
  }
  return `<section class="panel panel-customer" data-panel="customer" aria-label="Kundensicht"><header><span class="role">Kunde</span><span class="where">${s.phase === 'start' ? 'Am Tresen' : s.entry === 'nfc' ? 'Per NFC geöffnet' : 'Per QR geöffnet'}</span></header><div class="panel-body">${body}</div></section>`;
}

export function cashierPanel(s: DemoState, key: IndustryKey, mode: Mode): string {
  const x = industries[key], v = viewOf(s);
  const confirm = (action: string, text: string) => mode.interactive ? `<button type="button" class="button primary" data-action="${action}" data-next>${text}</button>` : '';
  let body: string;
  if (v.pendingRequest) body = `<div class="request-row"><div><strong>Neue Anfrage</strong><span>${s.entry === 'nfc' ? 'NFC-Tap' : 'QR-Scan'} · ${v.cardLabel}</span></div></div><p class="note">Noch kein Stempel – erst deine Bestätigung zählt.</p>${confirm('confirm', 'Besuch bestätigen')}`;
  else if (v.rewardReady) body = `<div class="request-row"><div><strong>Prämie verfügbar</strong><span>${escapeText(x.reward)} · ${v.cardLabel}</span></div></div>${confirm('redeem', 'Prämie einlösen')}`;
  else if (s.phase === 'confirmed') body = `<p class="status ok">✓ Besuch bestätigt – ein Stempel vergeben.</p>`;
  else if (s.phase === 'redeemed') body = `<p class="status ok">✓ Prämie eingelöst.</p>`;
  else body = `<p class="note">${s.phase === 'enroll' ? 'Der Kunde erstellt gerade seine Karte.' : 'Wartet auf den nächsten Besuch. Bezahlt wird wie gewohnt.'}</p>`;
  return `<section class="panel panel-cashier" data-panel="cashier" aria-label="Kassensicht"><header><span class="role">Kasse</span><span class="where">Dein Team</span></header><div class="panel-body">${body}</div></section>`;
}

export function ownerPanel(s: DemoState, key: IndustryKey): string {
  const v = viewOf(s), x = industries[key];
  const row = `<li><span>${escapeText(cap(x.visit))}</span><strong>+1</strong></li>`;
  const rows: string[] = [];
  for (let i = 0; i < v.confirmedVisits; i++) rows.push(row);
  if (v.redemptions) rows.push(`<li><span>Prämie eingelöst</span><strong>−${v.threshold}</strong></li>`);
  const cardLine = v.hasCard ? `${v.cardLabel}: <strong data-owner-balance>${v.balance} / ${v.threshold}</strong>` : `<span data-owner-balance-none>Noch keine Karte angelegt</span>`;
  return `<section class="panel panel-owner" data-panel="owner" aria-label="Inhaberansicht"><header><span class="role">Inhaber</span><span class="where">Überblick</span></header><div class="panel-body"><div class="metrics"><div><span>Bestätigte Besuche</span><strong data-visits>${v.confirmedVisits}</strong></div><div><span>Prämien eingelöst</span><strong data-redemptions>${v.redemptions}</strong></div></div><p class="owner-card">${cardLine}</p><ul class="activity">${rows.join('') || '<li class="empty"><span>Noch keine Aktivität in dieser Demo</span></li>'}</ul></div></section>`;
}

export const demoStage = (s: DemoState, key: IndustryKey, interactive = true) =>
  `${customerPanel(s, key, { interactive })}${cashierPanel(s, key, { interactive })}${ownerPanel(s, key)}<span class="marker" aria-hidden="true"></span>`;

/** The hero shows the end of one confirmed visit as one cluster: same state, three views, no controls. */
export function heroScene(key: IndustryKey): string {
  const s: DemoState = { phase: 'confirmed', entry: 'nfc', identity: 'returning', enrolled: false };
  const v = viewOf(s), x = industries[key];
  return `<figure class="hero-scene"><div class="hero-cluster" role="img" aria-label="Beispiel: Ein Kunde öffnet seine Karte, das Team bestätigt den Besuch, der Inhaber sieht ihn in seiner Übersicht."><div class="hero-phone"><div class="phone-screen">${card(v, key)}<p class="status ok">✓ Stempel erhalten</p></div></div><div class="hero-side"><div class="hero-cashier panel"><header><span class="role">Kasse</span><span class="where">Dein Team</span></header><div class="panel-body"><p class="status ok">✓ Besuch bestätigt</p><p class="note">${DEMO.example} · NFC-Tap</p></div></div><div class="hero-owner panel"><header><span class="role">Inhaber</span><span class="where">Überblick</span></header><div class="panel-body"><ul class="activity"><li><span>${escapeText(cap(x.visit))}</span><strong>+1</strong></li></ul><p class="owner-card">${DEMO.example}: <strong>${v.balance} / ${v.threshold}</strong></p></div></div></div></div><figcaption class="hero-label">Beispieldarstellung</figcaption></figure>`;
}

// ---- merchant moments (platform outlook: conditional wording, never implying delivery or active consent collection) ----------
export type MomentId = 'quiet' | 'missing' | 'near';
export const MOMENT_BADGE = 'Plattform-Ausblick – nicht im aktuellen Pilotangebot';
export const MESSAGE_TAG = 'Vorschau – Versand ist nicht Teil des aktuellen Angebots';
export const MOMENTS: Array<{ id: MomentId; tab: string; heading: (k: IndustryKey) => string; cta: string }> = [
  { id: 'quiet', tab: 'Ein ruhiger Nachmittag', heading: k => `${industries[k].quiet.when}. Was wäre, wenn heute mehr los wäre?`, cta: 'Beispielangebot ansehen' },
  { id: 'missing', tab: 'Ein Stammkunde fehlt', heading: () => 'Was, wenn dir auffiele, wann aus Regelmäßigkeit eine Pause wird?', cta: 'Mögliche Erinnerung ansehen' },
  { id: 'near', tab: 'Die nächste Prämie ist nah', heading: () => 'Was, wenn jemand kurz vor der Prämie einen freundlichen Anstoß bekäme?', cta: 'Beispielnachricht ansehen' },
];
const preview = (text: string, from: string) => `<div class="message" role="group" aria-label="Nachrichtenvorschau"><span class="message-tag">${MESSAGE_TAG}</span><p><strong>${escapeText(from)}</strong></p><p>${escapeText(text)}</p></div>`;

/** Tuesday by hour, 10–17 Uhr; the quiet interval 14–16 Uhr is highlighted. One dimension only. */
const HOURS: Array<[string, string, boolean]> = [['10', 'h62', false], ['11', 'h88', false], ['12', 'h78', false], ['13', 'h62', false], ['14', 'h30', true], ['15', 'h26', true], ['16', 'h30', true], ['17', 'h48', false]];
export const nearMessage = (reward: string) => `Noch ein Besuch – dann wartet ${reward} auf dich.`;

export function momentBody(id: MomentId, key: IndustryKey, revealed: boolean): string {
  const x = industries[key];
  if (id === 'quiet') {
    return `<div class="moment-grid"><div class="moment-card"><h4>Auslastung am Dienstag (Beispiel)</h4><div class="bars" role="img" aria-label="Beispiel: Auslastung am Dienstag nach Uhrzeit von 10 bis 17 Uhr. Zwischen 14 und 17 Uhr ist deutlich weniger los.">${HOURS.map(([, h, low]) => `<span class="${h}${low ? ' low' : ''}"></span>`).join('')}</div><div class="bar-labels" aria-hidden="true">${HOURS.map(([hr, , low]) => `<span${low ? ' class="low"' : ''}>${hr}</span>`).join('')}</div><p class="note">Uhrzeit · ruhig: 14 bis 17 Uhr. Beispieldarstellung, keine echten Zahlen.</p></div><div class="moment-card"><h4>Eine mögliche Gruppe</h4><p class="chip">Denkbar: Karten mit Kontakt-Einwilligung, die länger nicht da waren</p><ul class="mini-list"><li>${DEMO.example}<span>vor 21 Tagen</span></li><li>Beispielkarte 0388<span>vor 34 Tagen</span></li><li>Beispielkarte 0912<span>vor 29 Tagen</span></li></ul><p class="note">Nur wer zugestimmt hätte, könnte erreicht werden.</p></div></div>${revealed ? preview(x.quiet.message, x.name) + `<p class="outcome">${escapeText(x.quiet.outcome)} Ob und wie viele wirklich kommen, zeigt erst dein Alltag.</p>` : ''}`;
  }
  if (id === 'missing') {
    return `<div class="moment-grid"><div class="moment-card wide"><h4>${escapeText(x.regular.who)} · ${DEMO.example}</h4><div class="timeline" role="img" aria-label="Beispiel: regelmäßige Besuche, danach ${escapeText(x.regular.pause)} ohne bestätigten Besuch"><i></i><i></i><i></i><i></i><i></i><b>${escapeText(x.regular.pause)} Pause</b></div><p class="why"><strong>Warum würde diese Karte angezeigt?</strong> ${escapeText(x.regular.story)} (Beispielregel)</p><p class="note">Angezeigt würde nur die Pause – den Grund kennt nur dein Kunde. Kein Anlass, jemanden als verloren zu betrachten.</p></div></div>${revealed ? preview('Schön, dich bald wiederzusehen. Dein Stand wartet auf dich.', x.name) : ''}`;
  }
  return `<div class="moment-grid"><div class="moment-card"><h4>${DEMO.example}</h4><div class="stamp-grid small">${stamps(9, 10)}</div><p class="progress-line"><strong>9 / 10</strong> · ${escapeText(nearMessage(x.reward))}</p></div></div>${revealed ? preview(`${nearMessage(x.reward)} Wir freuen uns auf dich!`, x.name) : ''}`;
}
