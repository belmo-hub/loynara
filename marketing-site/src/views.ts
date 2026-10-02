import { DEMO, industries, type IndustryKey } from './site.js';
import { viewOf, type DemoState, type DemoView } from './demo.js';

export const escapeText = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const mark = '<img src="/assets/loynara-mark.svg" width="22" height="22" alt="">';

export const GUIDE = [
  { title: 'Der Kunde öffnet seine Karte', body: 'Ein Tap am NFC-Schild oder ein Scan des QR-Codes öffnet die Karte im Browser. Neue Kunden erstellen sie dabei, bekannte Kunden sehen sofort ihren Stand.' },
  { title: 'Dein Team bestätigt den Besuch', body: 'Die Anfrage erscheint an der Kasse. Erst mit „Besuch bestätigen“ wird ein Stempel vergeben – genau einmal.' },
  { title: 'Fortschritt und Überblick', body: 'Die Karte zeigt, wie nah die Prämie ist. In deiner Übersicht steht derselbe bestätigte Besuch.' },
  { title: 'Die Prämie wird eingelöst', body: 'Bei vollem Stand löst dein Team die Prämie aus. Die Karte beginnt wieder bei null, die Einlösung steht in der Übersicht.' },
] as const;

/** Ten stamps in two rows. `fresh` marks the stamp that has just been added so the browser can animate it. */
export function stamps(balance: number, threshold: number, fresh = -1): string {
  return Array.from({ length: threshold }, (_, i) => `<span class="stamp${i < balance ? ' filled' : ''}"${i === fresh ? ' data-fresh' : ''} aria-hidden="true">${i < balance ? '✓' : i + 1}</span>`).join('');
}

function card(view: DemoView, key: IndustryKey, dim = false): string {
  const x = industries[key];
  const label = view.rewardReady ? 'Prämie verfügbar' : view.remaining === 1 ? 'Noch ein Besuch bis zur Prämie' : view.balance === 0 ? 'Neuer Stand' : `Noch ${view.remaining} bis zur Prämie`;
  return `<div class="loy-card${dim ? ' is-dim' : ''}"><div class="loy-top">${mark}<span>${escapeText(x.name)}</span></div><p class="loy-reward">${escapeText(x.reward.charAt(0).toUpperCase() + x.reward.slice(1))} · ab ${view.threshold} Stempeln</p><div class="stamp-grid" data-stamps>${stamps(view.balance, view.threshold)}</div><div class="loy-total"><strong data-balance>${view.balance}<small> / ${view.threshold}</small></strong><span data-card-status>${label}</span></div></div>`;
}

type Mode = { interactive: boolean };
export function customerPanel(s: DemoState, key: IndustryKey, mode: Mode): string {
  const x = industries[key], v = viewOf(s), btn = (action: string, text: string, cls = 'secondary') => mode.interactive ? `<button type="button" class="button ${cls}" data-action="${action}">${text}</button>` : '';
  let body: string;
  switch (s.phase) {
    case 'start':
      body = `<div class="choice"><p class="choice-title">So kommt dein Kunde an</p><div class="segmented" role="group" aria-label="Kundentyp"><button type="button" data-action="identity-returning" aria-pressed="${s.identity === 'returning'}">Hat eine Karte</button><button type="button" data-action="identity-new" aria-pressed="${s.identity === 'new'}">Erster Besuch</button></div><div class="choice-buttons"><button type="button" class="button primary" data-action="open-nfc" data-next>Schild antippen (NFC)</button><button type="button" class="button secondary" data-action="open-qr">QR-Code scannen</button></div></div>`;
      break;
    case 'enroll':
      body = `<div class="choice"><p class="choice-title">Willkommen bei ${escapeText(x.name)}</p><p class="note">Ein erster Besuch erstellt die Karte in wenigen Sekunden – ohne App. In der Demo startet sie mit dem Beispielstand ${DEMO.startBalance} von ${DEMO.threshold}.</p>${btn('enroll', 'Karte erstellen', 'primary').replace('<button ', '<button data-next ')}</div>`;
      break;
    case 'request': case 'request2':
      body = `${card(v, key)}<p class="status" role="status">Besuch gemeldet – dein Team bestätigt gleich.</p>`; break;
    case 'confirmed':
      body = `${card(v, key)}<p class="status ok">✓ Stempel erhalten.</p>${btn('nextVisit', 'Nächsten Besuch zeigen').replace('<button ', '<button data-next ')}`; break;
    case 'reward':
      body = `${card(v, key)}<p class="status ok">Zeig dein Handy an der Kasse – dein Team löst die Prämie ein.</p>`; break;
    case 'redeemed':
      body = `${card(v, key)}<p class="status ok">✓ Prämie eingelöst. Auf zur nächsten!</p>`; break;
  }
  return `<section class="panel panel-customer" data-panel="customer" aria-label="Kundensicht"><header><span class="role">Kunde</span><span class="where">${s.phase === 'start' ? 'Am Tresen' : s.entry === 'nfc' ? 'Per NFC geöffnet' : 'Per QR geöffnet'}</span></header><div class="phone-frame">${body}</div></section>`;
}

export function cashierPanel(s: DemoState, key: IndustryKey, mode: Mode): string {
  const x = industries[key], v = viewOf(s);
  const confirm = (action: string, text: string) => mode.interactive ? `<button type="button" class="button primary" data-action="${action}" data-next>${text}</button>` : '';
  let body: string;
  if (v.pendingRequest) body = `<div class="request-row"><div><strong>Neue Anfrage</strong><span>${s.entry === 'nfc' ? 'NFC-Tap' : 'QR-Scan'} · ${DEMO.example}</span></div></div><p class="note">Noch kein Stempel – erst deine Bestätigung zählt.</p>${confirm('confirm', 'Besuch bestätigen')}`;
  else if (v.rewardReady) body = `<div class="request-row"><div><strong>Prämie verfügbar</strong><span>${escapeText(x.reward)} · ${DEMO.example}</span></div></div>${confirm('redeem', 'Prämie einlösen')}`;
  else if (s.phase === 'confirmed') body = `<p class="status ok">✓ Besuch bestätigt – ein Stempel vergeben.</p>`;
  else if (s.phase === 'redeemed') body = `<p class="status ok">✓ Prämie eingelöst.</p>`;
  else body = `<p class="note">${s.phase === 'enroll' ? 'Der Kunde erstellt gerade seine Karte.' : 'Wartet auf den nächsten Besuch. Bezahlt wird wie gewohnt.'}</p>`;
  return `<section class="panel panel-cashier" data-panel="cashier" aria-label="Kassensicht"><header><span class="role">Kasse</span><span class="where">Dein Team</span></header><div class="panel-body">${body}</div></section>`;
}

export function ownerPanel(s: DemoState, key: IndustryKey): string {
  const v = viewOf(s), x = industries[key];
  const rows: string[] = [];
  if (v.confirmedVisits >= 1) rows.push(`<li><span>${escapeText(x.visit.charAt(0).toUpperCase() + x.visit.slice(1))}</span><strong>+1</strong></li>`);
  if (v.confirmedVisits >= 2) rows.push(`<li><span>${escapeText(x.visit.charAt(0).toUpperCase() + x.visit.slice(1))}</span><strong>+1</strong></li>`);
  if (v.redemptions) rows.push(`<li><span>Prämie eingelöst</span><strong>−${v.threshold}</strong></li>`);
  return `<section class="panel panel-owner" data-panel="owner" aria-label="Inhaberansicht"><header><span class="role">Inhaber</span><span class="where">Überblick</span></header><div class="panel-body"><div class="metrics"><div><span>Bestätigte Besuche</span><strong data-visits>${v.confirmedVisits}</strong></div><div><span>Prämien eingelöst</span><strong data-redemptions>${v.redemptions}</strong></div></div><p class="owner-card">${DEMO.example}: <strong data-owner-balance>${v.balance} / ${v.threshold}</strong></p><ul class="activity">${rows.join('') || '<li class="empty"><span>Noch keine Aktivität in dieser Demo</span></li>'}</ul></div></section>`;
}

export const demoStage = (s: DemoState, key: IndustryKey, interactive = true) =>
  `${customerPanel(s, key, { interactive })}${cashierPanel(s, key, { interactive })}${ownerPanel(s, key)}<span class="marker" aria-hidden="true"></span>`;

/** The hero shows the end of one confirmed visit: the same state, three views, no controls. */
export function heroScene(key: IndustryKey): string {
  const s: DemoState = { phase: 'confirmed', entry: 'nfc', identity: 'returning', enrolled: false };
  const v = viewOf(s);
  return `<div class="hero-scene" role="img" aria-label="Beispiel: Ein Kunde öffnet seine Karte, das Team bestätigt den Besuch, der Inhaber sieht ihn in seiner Übersicht."><div class="hero-phone"><div class="phone-frame">${card(v, key)}<p class="status ok">✓ Stempel erhalten · Noch ein Besuch bis zur Prämie</p></div></div><div class="hero-cashier panel"><header><span class="role">Kasse</span><span class="where">Dein Team</span></header><div class="panel-body"><p class="status ok">✓ Besuch bestätigt</p><p class="note">Beispielkarte 4217 · NFC-Tap</p></div></div><div class="hero-owner panel"><header><span class="role">Inhaber</span><span class="where">Überblick</span></header><div class="panel-body"><div class="metrics"><div><span>Bestätigte Besuche</span><strong>${v.confirmedVisits}</strong></div></div></div></div><span class="hero-label">Interaktive Demo · Beispieldaten</span></div>`;
}

// ---- merchant moments ------------------------------------------------------------------------------------------
export type MomentId = 'quiet' | 'missing' | 'near';
export const MOMENTS: Array<{ id: MomentId; tab: string; heading: (k: IndustryKey) => string; cta: string }> = [
  { id: 'quiet', tab: 'Ein ruhiger Nachmittag', heading: k => `${industries[k].quiet.when}. Heute darf mehr los sein.`, cta: 'Beispielangebot ansehen' },
  { id: 'missing', tab: 'Ein Stammkunde fehlt', heading: () => 'Du bemerkst, wenn aus Regelmäßigkeit eine Pause wird.', cta: 'Mögliche Erinnerung ansehen' },
  { id: 'near', tab: 'Die nächste Prämie ist nah', heading: () => 'Wer fast am Ziel ist, bekommt einen freundlichen Anstoß.', cta: 'Erinnerung ansehen' },
];
const preview = (text: string, from: string) => `<div class="message" role="group" aria-label="Nachrichtenvorschau"><span class="message-tag">Vorschau · wird in dieser Demo nicht versendet</span><p><strong>${escapeText(from)}</strong></p><p>${escapeText(text)}</p></div>`;

export function momentBody(id: MomentId, key: IndustryKey, revealed: boolean): string {
  const x = industries[key];
  if (id === 'quiet') {
    return `<div class="moment-grid"><div class="moment-card"><h4>Auslastung im Überblick</h4><div class="bars" role="img" aria-label="Beispiel: Montag bis Samstag, der ${escapeText(x.quiet.slot)} ist deutlich schwächer ausgelastet"><span class="h62"></span><span class="h48"></span><span class="h30 low"></span><span class="h70"></span><span class="h78"></span><span class="h88"></span></div><div class="bar-labels"><span>Mo</span><span>Di</span><span class="low">Di 14–17</span><span>Mi</span><span>Do</span><span>Fr</span></div><p class="note">Beispieldarstellung, keine echten Zahlen.</p></div><div class="moment-card"><h4>Mögliche Gruppe</h4><p class="chip">Karten mit Kontakt-Einwilligung · zuletzt vor 3 bis 6 Wochen da</p><ul class="mini-list"><li>${DEMO.example}<span>vor 21 Tagen</span></li><li>Beispielkarte 0388<span>vor 34 Tagen</span></li><li>Beispielkarte 0912<span>vor 29 Tagen</span></li></ul><p class="note">Nur wer zugestimmt hat, würde erreicht.</p></div></div>${revealed ? preview(x.quiet.message, x.name) + '<p class="outcome">Fiktives Beispiel: Zwei Gäste buchen den Dienstagnachmittag. Ob und wie viele zurückkommen, zeigt erst dein Alltag.</p>' : ''}`;
  }
  if (id === 'missing') {
    return `<div class="moment-grid"><div class="moment-card wide"><h4>${escapeText(x.regular.who)} · ${DEMO.example}</h4><div class="timeline" role="img" aria-label="Beispiel: regelmäßige Besuche, danach sechs Wochen ohne bestätigten Besuch"><i></i><i></i><i></i><i></i><i></i><b>6 Wochen Pause</b></div><p class="why"><strong>Warum angezeigt?</strong> ${escapeText(x.regular.rhythm)}, seit 6 Wochen kein bestätigter Besuch (Beispielregel).</p><p class="note">Loynara zeigt die Pause – den Grund kennt nur dein Kunde. Kein Grund, jemanden als verloren zu betrachten.</p></div></div>${revealed ? preview('Schön, dich bald wiederzusehen. Dein Stand wartet auf dich.', x.name) : ''}`;
  }
  return `<div class="moment-grid"><div class="moment-card"><h4>${DEMO.example}</h4><div class="stamp-grid small">${stamps(9, 10)}</div><p class="progress-line"><strong>9 / 10</strong> · Noch ein Besuch bis „${escapeText(x.reward)}“</p></div></div>${revealed ? preview(`Noch ein Besuch bis ${x.reward}. Wir freuen uns auf dich!`, x.name) : ''}`;
}
