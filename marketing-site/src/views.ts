import { DEMO, industries, type IndustryKey } from './site.js';
import { viewOf, chapterOf, type Chapter, type DemoState, type DemoView } from './demo.js';
import { refView, REF_STEPS, REF_RULE, type RefState } from './ref.js';
import { LOGOS, STYLES, REWARD_LABELS, rewardText, type BrandState, type LogoKey, type RewardKey, type StyleKey } from './brand.js';

export const escapeText = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const logoSvg = (b: BrandState, size = 22) => LOGOS[b.logo].svg.replace('<svg ', `<svg class="logo" width="${size}" height="${size}" `);

// ---- journey: chapters ---------------------------------------------------------------------------------------------------------
export const CHAPTERS: Array<{ id: Chapter; n: number; label: string; sub: string; instruction: string }> = [
  { id: 'start', n: 1, label: 'Starten', sub: 'Tap oder Scan öffnet die Karte', instruction: 'Der Kunde tippt das Schild oder scannt den QR-Code und öffnet seine Karte – ohne App.' },
  { id: 'collect', n: 2, label: 'Sammeln', sub: 'Dein Team bestätigt jeden Besuch', instruction: 'Dein Team bestätigt den Besuch – erst dann gibt es einen Stempel, genau einmal.' },
  { id: 'reward', n: 3, label: 'Belohnen', sub: 'Voller Stand, Prämie, Einlösung', instruction: 'Bei vollem Stand löst dein Team die Prämie ein. Der Inhaber sieht die Einlösung.' },
  { id: 'refer', n: 4, label: 'Empfehlen', sub: 'Freund bringt Freund', instruction: 'Link teilen, Freund meldet sich an, erster Besuch wird bestätigt – dann gibt es den Bonus.' },
];
export const GROWTH = ['Besuch', 'Fortschritt', 'Prämie', 'Empfehlung', 'neuer Besuch'] as const;
const GROWTH_AT: Record<Chapter, number> = { start: 0, collect: 1, reward: 2, refer: 3 };
export const growthStrip = (c: Chapter, qualified = false) => `<ol class="growth" aria-label="Kreislauf">${GROWTH.map((g, i) => `<li${i === GROWTH_AT[c] || (qualified && i === 4) ? ' class="on"' : ''}>${g}</li>`).join('')}</ol>`;

export function chapterTabs(current: Chapter): string {
  return `<div class="tabs chapters" role="tablist" aria-label="Kapitel des Ablaufs">${CHAPTERS.map(c => `<button type="button" role="tab" id="tab-${c.id}" class="tab" data-chapter="${c.id}" aria-selected="${c.id === current}" aria-controls="journey-panel" tabindex="${c.id === current ? 0 : -1}"><span class="tab-n">${c.n}</span><span class="tab-text"><strong>${c.label}</strong><small>${c.sub}</small></span></button>`).join('')}</div>`;
}

/** Ten stamps in two rows. */
export function stamps(balance: number, threshold: number): string {
  return Array.from({ length: threshold }, (_, i) => `<span class="stamp${i < balance ? ' filled' : ''}" aria-hidden="true">${i < balance ? '✓' : i + 1}</span>`).join('');
}

/** Browser loyalty card. Colours come from the brand variables of the nearest brand scope. */
export function loyCard(o: { balance: number; threshold: number; status: string; name: string; reward: string; brand: BrandState; mini?: boolean }): string {
  return `<div class="loy-card${o.mini ? ' mini' : ''}"><div class="loy-top">${logoSvg(o.brand)}<span>${escapeText(o.name)}</span></div><p class="loy-reward">${escapeText(cap(o.reward))} · ab ${o.threshold} Stempeln</p><div class="stamp-grid" data-stamps>${stamps(o.balance, o.threshold)}</div><div class="loy-total"><strong data-balance>${o.balance}<small> / ${o.threshold}</small></strong><span data-card-status>${o.status}</span></div></div>`;
}
function demoCard(view: DemoView, key: IndustryKey, brand: BrandState): string {
  const label = view.rewardReady ? 'Prämie verfügbar' : view.remaining === 1 ? 'Noch ein Besuch bis zur Prämie' : view.balance === 0 ? 'Neuer Stand' : `Noch ${view.remaining} bis zur Prämie`;
  return loyCard({ balance: view.balance, threshold: view.threshold, status: label, name: industries[key].name, reward: rewardText(brand, key), brand });
}

type Mode = { interactive: boolean };
const withNext = (html: string) => html.replace('<button ', '<button data-next ');

export function customerPanel(s: DemoState, key: IndustryKey, brand: BrandState, mode: Mode): string {
  const x = industries[key], v = viewOf(s), btn = (action: string, text: string, cls = 'secondary') => mode.interactive ? `<button type="button" class="button ${cls}" data-action="${action}">${text}</button>` : '';
  let body: string, summary: string;
  switch (s.phase) {
    case 'start':
      summary = 'Wartet am Tresen';
      body = `<div class="choice"><p class="choice-title">Welche Karte öffnet dein Kunde?</p><div class="segmented" role="group" aria-label="Kartentyp"><button type="button" data-action="identity-returning" aria-pressed="${s.identity === 'returning'}">Bestandskarte<small>8 von 10</small></button><button type="button" data-action="identity-new" aria-pressed="${s.identity === 'new'}">Neue Karte<small>0 von 10</small></button></div><div class="choice-buttons"><button type="button" class="button primary" data-action="open-nfc" data-next>Schild antippen (NFC)</button><button type="button" class="button secondary" data-action="open-qr">QR-Code scannen</button></div></div>`;
      break;
    case 'enroll':
      summary = 'Erstellt eine neue Karte';
      body = `<div class="choice"><p class="choice-title">Willkommen bei ${escapeText(x.name)}</p><p class="note">Die Karte startet bei 0 von ${DEMO.threshold}: Der Fortschritt beginnt mit dem ersten bestätigten Besuch.</p>${withNext(btn('enroll', 'Karte erstellen', 'primary'))}</div>`;
      break;
    case 'request': case 'request2':
      summary = `Besuch gemeldet · Stand ${v.balance}/${v.threshold}`;
      body = `${demoCard(v, key, brand)}<p class="status" role="status">Besuch gemeldet – dein Team bestätigt gleich.</p>`; break;
    case 'confirmed':
      summary = `Stempel erhalten · Stand ${v.balance}/${v.threshold}`;
      body = `${demoCard(v, key, brand)}<p class="status ok">✓ Stempel erhalten.</p>${s.identity === 'returning' ? '' : withNext(btn('use-returning', 'Mit Bestandskarte weiter ausprobieren'))}`; break;
    case 'reward':
      summary = 'Prämie verfügbar';
      body = `${demoCard(v, key, brand)}<p class="status ok">Zeig dein Handy an der Kasse – dein Team löst die Prämie ein.</p>`; break;
    case 'redeemed':
      summary = 'Prämie eingelöst · Stand 0';
      body = `${demoCard(v, key, brand)}<p class="status ok">✓ Prämie eingelöst. Auf zur nächsten!</p>`; break;
  }
  return `<section class="panel panel-customer" data-panel="customer" aria-label="Kundensicht"><header><span class="role">Kunde</span><span class="where">${s.phase === 'start' ? 'Am Tresen' : s.entry === 'nfc' ? 'Per NFC geöffnet' : 'Per QR geöffnet'}</span></header><p class="panel-summary">${summary}</p><div class="panel-body">${body}</div></section>`;
}

export function cashierPanel(s: DemoState, key: IndustryKey, brand: BrandState, mode: Mode): string {
  const v = viewOf(s);
  const confirm = (action: string, text: string) => mode.interactive ? `<button type="button" class="button primary" data-action="${action}" data-next>${text}</button>` : '';
  let body: string, summary: string;
  if (v.pendingRequest) { summary = 'Anfrage offen'; body = `<div class="request-row"><div><strong>Neue Anfrage</strong><span>${s.entry === 'nfc' ? 'NFC-Tap' : 'QR-Scan'} · ${v.cardLabel}</span></div></div><p class="note">Noch kein Stempel – erst deine Bestätigung zählt.</p>${confirm('confirm', 'Besuch bestätigen')}`; }
  else if (v.rewardReady) { summary = 'Prämie bereit'; body = `<div class="request-row"><div><strong>Prämie verfügbar</strong><span>${escapeText(rewardText(brand, key))} · ${v.cardLabel}</span></div></div>${confirm('redeem', 'Prämie einlösen')}`; }
  else if (s.phase === 'confirmed') { summary = 'Besuch bestätigt'; body = `<p class="status ok">✓ Besuch bestätigt – ein Stempel vergeben.</p>`; }
  else if (s.phase === 'redeemed') { summary = 'Prämie eingelöst'; body = `<p class="status ok">✓ Prämie eingelöst.</p>`; }
  else { summary = 'Wartet auf Besuch'; body = `<p class="note">${s.phase === 'enroll' ? 'Der Kunde erstellt gerade seine Karte.' : 'Wartet auf den nächsten Besuch. Bezahlt wird wie gewohnt.'}</p>`; }
  return `<section class="panel panel-cashier" data-panel="cashier" aria-label="Kassensicht"><header><span class="role">Kasse</span><span class="where">Dein Team</span></header><p class="panel-summary">${summary}</p><div class="panel-body">${body}</div></section>`;
}

export function ownerPanel(s: DemoState, key: IndustryKey): string {
  const v = viewOf(s), x = industries[key];
  const row = `<li><span>${escapeText(cap(x.visit))}</span><strong>+1</strong></li>`;
  const rows: string[] = [];
  for (let i = 0; i < v.confirmedVisits; i++) rows.push(row);
  if (v.redemptions) rows.push(`<li><span>Prämie eingelöst</span><strong>−${v.threshold}</strong></li>`);
  const cardLine = v.hasCard ? `${v.cardLabel}: <strong data-owner-balance>${v.balance} / ${v.threshold}</strong>` : `<span data-owner-balance-none>Noch keine Karte angelegt</span>`;
  return `<section class="panel panel-owner" data-panel="owner" aria-label="Inhaberansicht"><header><span class="role">Inhaber</span><span class="where">Überblick</span></header><p class="panel-summary">${v.confirmedVisits} Besuche · ${v.redemptions} Prämien</p><div class="panel-body"><div class="metrics"><div><span>Bestätigte Besuche</span><strong data-visits>${v.confirmedVisits}</strong></div><div><span>Prämien eingelöst</span><strong data-redemptions>${v.redemptions}</strong></div></div><p class="owner-card">${cardLine}</p><ul class="activity">${rows.join('') || '<li class="empty"><span>Noch keine Aktivität in dieser Demo</span></li>'}</ul></div></section>`;
}

/** The referral example: two clearly fictional cards, a four-step status line, one rule line, owner counters. */
export function refStage(r: RefState, key: IndustryKey, brand: BrandState, mode: Mode): string {
  const v = refView(r), x = industries[key], th = DEMO.threshold;
  const btn = (action: string, text: string, cls = 'primary') => mode.interactive ? `<button type="button" class="button ${cls}" data-action="${action}" data-next>${text}</button>` : '';
  const a = loyCard({ balance: v.referrerBalance, threshold: th, status: r.phase === 'qualified' ? '+1 Empfehlungsbonus' : `Noch ${th - v.referrerBalance} bis zur Prämie`, name: x.name, reward: rewardText(brand, key), brand, mini: true });
  const aNote = r.phase === 'idle' ? btn('ref-share', 'Empfehlungslink teilen') : r.phase === 'shared' || r.phase === 'opened' ? '<p class="status">Link geteilt – Beispiel, nichts wurde versendet.</p>' : r.phase === 'joined' ? '<p class="status">Wartet auf den ersten bestätigten Besuch des Freundes.</p>' : '<p class="status ok">✓ Bonus einmal verbucht.</p>';
  let b: string;
  if (r.phase === 'idle') b = '<div class="friend-empty"><strong>Freund B</strong><p class="note">Noch nicht beteiligt.</p></div>';
  else if (r.phase === 'shared') b = `<div class="friend-empty"><strong>Freund B</strong><p class="note">Hat den Link noch nicht geöffnet. Allein das Teilen bringt keinen Bonus.</p>${btn('ref-open', 'Freund öffnet den Link', 'secondary')}</div>`;
  else if (r.phase === 'opened') b = `<div class="friend-empty"><strong>Willkommen bei ${escapeText(x.name)}</strong><p class="note">Empfohlen von einem Stammkunden. Das Öffnen allein bringt keinen Bonus.</p>${btn('ref-join', 'Karte erstellen')}</div>`;
  else b = loyCard({ balance: v.friendBalance ?? 0, threshold: th, status: r.phase === 'joined' ? 'Teilnahme offen' : 'Erster Stempel', name: x.name, reward: rewardText(brand, key), brand, mini: true });
  const bNote = r.phase === 'joined' ? `<div class="request-row"><div><strong>Neue Anfrage · Freund B</strong><span>Erster Besuch</span></div></div>${btn('ref-confirm', 'Besuch bestätigen')}` : r.phase === 'qualified' ? '<p class="status ok">✓ Erster Besuch bestätigt.</p>' : '';
  const steps = `<ol class="ref-steps" aria-label="Status der Empfehlung">${REF_STEPS.map((t, i) => `<li class="${i < v.step || (v.step === 3 && i === 3) ? 'done' : i === v.step ? 'now' : ''}"${i === v.step ? ' aria-current="step"' : ''}>${t}</li>`).join('')}</ol>`;
  return `${steps}<div class="ref-cards"><section class="panel ref-a${r.phase === 'idle' || r.phase === 'qualified' ? ' is-active' : ''}" data-panel="ref-a" aria-label="Empfehlender Kunde"><header><span class="role">Stammkunde A</span><span class="where">Beispiel</span></header><p class="panel-summary">Stand ${v.referrerBalance}/${th}</p><div class="panel-body">${a}${aNote}</div></section><section class="panel ref-b${r.phase === 'shared' || r.phase === 'opened' || r.phase === 'joined' ? ' is-active' : ''}" data-panel="ref-b" aria-label="Eingeladener Freund"><header><span class="role">Freund B</span><span class="where">${v.friendJoined ? 'Angemeldet' : 'Noch nicht angemeldet'}</span></header><p class="panel-summary">${v.friendJoined ? `Stand ${v.friendBalance}/${th}` : 'Noch nicht angemeldet'}</p><div class="panel-body">${b}${bNote}</div></section></div><p class="rule-line"><strong>Beispielregel:</strong> +${REF_RULE.referrerBonus} Bonusstempel für den Empfehlenden, sobald dein Team den ersten Besuch des Freundes bestätigt. Ein Bonus für den Freund ist einstellbar.</p><div class="ref-owner" data-panel="owner"><span class="role">Inhaber</span><span>Qualifizierte Empfehlungen <b data-ref-qualified>${v.qualifiedReferrals}</b></span><span>Bestätigte Besuche <b data-ref-visits>${v.confirmedVisits}</b></span><span>Verbuchte Boni <b data-ref-bonus>${v.bonusBooked}</b></span></div>`;
}

/** Whole journey stage for the selected chapter. */
export function journeyStage(chapter: Chapter, demo: DemoState, ref: RefState, key: IndustryKey, brand: BrandState, interactive = true): string {
  if (chapter === 'refer') return refStage(ref, key, brand, { interactive });
  const needs = chapter === 'reward' && demo.identity === 'new';
  const notice = needs ? `<p class="notice">Eine neue Karte braucht zehn bestätigte Besuche. Das Einlösen siehst du an einer Bestandskarte. ${interactive ? '<button type="button" class="text-button" data-action="use-returning" data-next>Bestandskarte laden</button>' : ''}</p>` : '';
  return `${notice}<div class="stage-panels">${customerPanel(demo, key, brand, { interactive })}${cashierPanel(demo, key, brand, { interactive })}${ownerPanel(demo, key)}<span class="marker" aria-hidden="true"></span></div>`;
}
export function journeyStrip(chapter: Chapter, demo: DemoState, ref: RefState): { instruction: string; result: string } {
  const c = CHAPTERS.find(x => x.id === chapter)!;
  if (chapter === 'refer') { const v = refView(ref); return { instruction: c.instruction, result: `A ${v.referrerBalance}/${DEMO.threshold} · Empfehlungen ${v.qualifiedReferrals}` }; }
  const v = viewOf(demo);
  return { instruction: c.instruction, result: `Stand ${v.balance}/${v.threshold} · Besuche ${v.confirmedVisits} · Prämien ${v.redemptions}` };
}
export { chapterOf };

// ---- hero ----------------------------------------------------------------------------------------------------------------------------
export function standSvg(brand: BrandState, name: string, size: 'lg' | 'sm' = 'lg'): string {
  const cells = [[0, 2], [1, 0], [1, 3], [2, 1], [2, 4], [3, 2], [3, 5], [4, 0], [4, 3], [5, 1], [5, 4], [6, 2], [2, 6], [0, 5], [6, 5], [4, 6]];
  const qr = `<g class="stand-qr" transform="translate(78 150)"><rect width="46" height="46" rx="4" class="qr-bg"/>${cells.map(([x, y]) => `<rect x="${4 + x * 5.2}" y="${4 + y * 5.2}" width="4" height="4" class="qr-dot"/>`).join('')}<path d="M5 5h13v13H5zM28 5h13v13H28zM5 28h13v13H5z" class="qr-find"/></g>`;
  const mark = LOGOS[brand.logo].svg.replace('<svg ', '<svg class="stand-logo" x="86" y="58" width="30" height="30" ');
  return `<svg class="stand stand-${size}" viewBox="0 0 200 250" role="img" aria-label="Gestaltungsbeispiel: Aufsteller für den Tresen mit Logo, Anleitung, NFC-Symbol und QR-Fläche"><path class="stand-base" d="M20 236 56 214h88l36 22z"/><path class="stand-back" d="M44 214 58 24h84l14 190z"/><path class="stand-face" d="M52 218 64 18h72l12 200z"/>${mark}<text class="stand-name" x="100" y="108" text-anchor="middle">${escapeText(name.length > 18 ? name.slice(0, 17) + '…' : name)}</text><text class="stand-line" x="100" y="128" text-anchor="middle">Handy antippen</text><text class="stand-line" x="100" y="142" text-anchor="middle">oder Code scannen</text>${qr}<g class="stand-nfc" transform="translate(100 214)"><path d="M-12-6a14 14 0 0 1 0 12M-6-10a20 20 0 0 1 0 20M0-14a26 26 0 0 1 0 28" fill="none" stroke-width="3" stroke-linecap="round"/></g></svg>`;
}
export function paperStrip(key: IndustryKey, brand: BrandState): string {
  const x = industries[key];
  return `<div class="paper-strip"><p><strong>Nicht nur Stempel sammeln.</strong> Den nächsten Besuch mitdenken.</p><div class="paper-flow" role="img" aria-label="Aus der Papierkarte mit zehn Stempeln wird die digitale Karte mit Fortschritt und Überblick."><div class="paper-card mini-paper"><div class="paper-stamps">${Array.from({ length: 10 }, (_, i) => `<i class="${i < 9 ? 'on' : 'fresh'}"></i>`).join('')}</div></div><span class="paper-arrow" aria-hidden="true">→</span>${loyCard({ balance: 9, threshold: 10, status: 'Noch ein Besuch', name: x.name, reward: x.reward, brand, mini: true })}</div></div>`;
}
export function heroScene(key: IndustryKey, brand: BrandState): string {
  const s: DemoState = { phase: 'confirmed', entry: 'nfc', identity: 'returning', enrolled: false };
  const v = viewOf(s), x = industries[key];
  return `<figure class="hero-scene"><div class="hero-cluster" role="img" aria-label="Beispiel: Am Tresen steht der Aufsteller, der Kunde öffnet seine Karte, das Team bestätigt den Besuch, der Inhaber sieht ihn in seiner Übersicht."><div class="hero-stand">${standSvg(brand, x.name, 'sm')}</div><div class="hero-phone"><div class="phone-screen">${demoCard(v, key, brand)}<p class="status ok">✓ Stempel erhalten</p></div></div><div class="hero-side"><div class="hero-cashier panel"><header><span class="role">Kasse</span><span class="where">Dein Team</span></header><div class="panel-body"><p class="status ok">✓ Besuch bestätigt</p></div></div><div class="hero-owner panel"><header><span class="role">Inhaber</span><span class="where">Überblick</span></header><div class="panel-body"><ul class="activity"><li><span>${escapeText(cap(x.visit))}</span><strong>+1</strong></li></ul></div></div></div></div><ol class="hero-flow" aria-label="Ablauf"><li>Tresen</li><li>Karte</li><li>Team bestätigt</li><li>Überblick</li><li class="ref">Empfehlung ↺</li></ol><figcaption class="hero-label">Beispieldarstellung</figcaption></figure>`;
}

// ---- owner workspace ----------------------------------------------------------------------------------------------------------------
export type OwnerView = 'overview' | 'quiet' | 'win';
export const OWNER_BADGE = 'Plattform-Ausblick – nicht im aktuellen Pilotangebot';
export const MESSAGE_TAG = 'Vorschau – Versand ist nicht Teil des aktuellen Angebots';
export const OWNER_VIEWS: Array<{ id: OwnerView; label: string; sub: string; outlook: boolean; cta: string }> = [
  { id: 'overview', label: 'Überblick', sub: 'Was passiert ist', outlook: false, cta: '' },
  { id: 'quiet', label: 'Ruhige Zeiten', sub: 'Wann wenig los ist', outlook: true, cta: 'Nachricht ansehen' },
  { id: 'win', label: 'Zurückholen', sub: 'Wer länger fehlt', outlook: true, cta: 'Nachricht ansehen' },
];
export function ownerTabs(current: OwnerView): string {
  return `<div class="tabs owner-tabs" role="tablist" aria-label="Ansichten des Inhaber-Bereichs">${OWNER_VIEWS.map(v => `<button type="button" role="tab" id="otab-${v.id}" class="tab" data-owner-view="${v.id}" aria-selected="${v.id === current}" aria-controls="owner-panel" tabindex="${v.id === current ? 0 : -1}"><span class="tab-text"><strong>${v.label}</strong><small>${v.sub}${v.outlook ? ' · Ausblick' : ''}</small></span></button>`).join('')}</div>`;
}
const preview = (text: string, from: string) => `<div class="message" role="group" aria-label="Nachrichtenvorschau"><span class="message-tag">${MESSAGE_TAG}</span><p><strong>${escapeText(from)}</strong></p><p>${escapeText(text)}</p></div>`;
const HOURS: Array<[string, string, boolean]> = [['10', 'h62', false], ['11', 'h88', false], ['12', 'h78', false], ['13', 'h62', false], ['14', 'h30', true], ['15', 'h26', true], ['16', 'h30', true], ['17', 'h48', false]];
export const nearMessage = (reward: string) => `Noch ein Besuch – dann wartet ${reward} auf dich.`;
export const flowLine = (steps: string[]) => `<p class="flowline">${steps.map(s => `<span>${s}</span>`).join('<i aria-hidden="true">→</i>')}</p>`;

export function ownerBody(view: OwnerView, key: IndustryKey, revealed: boolean): string {
  const x = industries[key];
  if (view === 'overview') {
    return `<div class="facts"><div><strong>12</strong><span>wiederholte Besuche, vom Team bestätigt</span></div><div><strong>3</strong><span>Prämien eingelöst</span></div><div><strong>2</strong><span>Empfehlungen qualifiziert</span></div></div><p class="note">Beispieldaten. Aufgezeichnete Aktivität, kein Beleg für Zusatzumsatz durch Loynara.</p>`;
  }
  if (view === 'quiet') {
    return `<div class="moment-top"><span class="badge dark">${OWNER_BADGE}</span></div>${flowLine([`${x.quiet.when}`, 'passendes Angebot vorbereiten', 'Nachricht ansehen'])}<div class="moment-grid"><div class="moment-card"><h3>Auslastung am Dienstag (Beispiel)</h3><div class="bars" role="img" aria-label="Beispiel: Auslastung am Dienstag nach Uhrzeit von 10 bis 17 Uhr. Zwischen 14 und 17 Uhr ist deutlich weniger los.">${HOURS.map(([, h, low]) => `<span class="${h}${low ? ' low' : ''}"></span>`).join('')}</div><div class="bar-labels" aria-hidden="true">${HOURS.map(([hr, , low]) => `<span${low ? ' class="low"' : ''}>${hr}</span>`).join('')}</div><p class="note">Uhrzeit · ruhig: 14 bis 17 Uhr. Keine echten Zahlen.</p></div><div class="moment-card"><h3>Eine mögliche Gruppe</h3><p class="chip">Denkbar: Karten mit Kontakt-Einwilligung, die länger nicht da waren</p><p class="note">Nur wer zugestimmt hätte, könnte erreicht werden.</p></div></div>${revealed ? preview(x.quiet.message, x.name) + `<p class="outcome">${escapeText(x.quiet.outcome)} Ob und wie viele wirklich kommen, zeigt erst dein Alltag.</p>` : ''}`;
  }
  return `<div class="moment-top"><span class="badge dark">${OWNER_BADGE}</span></div>${flowLine(['Längere Pause erkannt', 'passenden Anlass auswählen', 'Nachricht ansehen'])}<div class="moment-card wide"><h3>${escapeText(x.regular.who)} · ${DEMO.example}</h3><div class="timeline" role="img" aria-label="Beispiel: regelmäßige Besuche, danach ${escapeText(x.regular.pause)} ohne bestätigten Besuch"><i></i><i></i><i></i><i></i><i></i><b>${escapeText(x.regular.pause)} Pause</b></div><p class="why"><strong>Warum würde diese Karte angezeigt?</strong> ${escapeText(x.regular.story)} (Beispielregel)</p><p class="note">Angezeigt würde nur die Pause – den Grund kennt nur dein Kunde.</p></div>${revealed ? preview('Schön, dich bald wiederzusehen. Dein Stand wartet auf dich.', x.name) : ''}`;
}

// ---- studio ----------------------------------------------------------------------------------------------------------------------------------
export function walletPass(brand: BrandState, key: IndustryKey): string {
  const x = industries[key], v = 8;
  return `<div class="wallet-phone" role="img" aria-label="Wallet-Vorschau: Karte mit Name, Stempelstand und Prämie"><p class="wallet-bar">Wallet-Vorschau</p><div class="wallet-pass"><div class="wp-top"><span class="wp-logo">${logoSvg(brand, 22)}</span><span class="wp-name">${escapeText(x.name)}</span></div><div class="wp-fields"><div><small>STEMPEL</small><strong>${v} / ${DEMO.threshold}</strong></div><div><small>PRÄMIE</small><span>${escapeText(rewardText(brand, key))}</span></div></div><div class="wp-code" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div></div>`;
}
export function browserPhone(brand: BrandState, key: IndustryKey): string {
  const x = industries[key];
  return `<div class="browser-phone"><p class="phone-url" aria-hidden="true">getloynara.com/…</p>${loyCard({ balance: 8, threshold: DEMO.threshold, status: 'Noch 2 bis zur Prämie', name: x.name, reward: rewardText(brand, key), brand, mini: true })}</div>`;
}
export function studioComposition(brand: BrandState, key: IndustryKey): string {
  const x = industries[key];
  return `<div class="studio-comp"><figure class="studio-stand">${standSvg(brand, x.name)}<figcaption>Gestaltungsbeispiel</figcaption></figure><div class="studio-phone"><p class="studio-label">Browserkarte</p>${browserPhone(brand, key)}</div><div class="studio-wallet"><p class="studio-label">Wallet-Vorschau</p>${walletPass(brand, key)}</div></div>`;
}
const swatch = (k: StyleKey, cur: StyleKey) => `<button type="button" class="swatch-btn" data-brand-style="${k}" aria-pressed="${k === cur}" aria-label="${STYLES[k].label}" title="${STYLES[k].label}"><span class="sw" data-sw="${k}"></span></button>`;
export function studioControls(brand: BrandState): string {
  return `<div class="studio-controls"><fieldset><legend>Markenstil <b id="lbl-style">${STYLES[brand.style].label}</b></legend><div class="opts">${(Object.keys(STYLES) as StyleKey[]).map(k => swatch(k, brand.style)).join('')}</div></fieldset><fieldset><legend>Logo <b id="lbl-logo">${LOGOS[brand.logo].label}</b></legend><div class="opts">${(Object.keys(LOGOS) as LogoKey[]).map(k => `<button type="button" class="opt-btn logo-btn" data-brand-logo="${k}" aria-pressed="${k === brand.logo}" aria-label="${LOGOS[k].label}" title="${LOGOS[k].label}"><span class="opt-logo">${LOGOS[k].svg}</span></button>`).join('')}</div></fieldset><fieldset><legend>Prämie</legend><div class="opts">${(Object.keys(REWARD_LABELS) as RewardKey[]).map(k => `<button type="button" class="opt-btn" data-brand-reward="${k}" aria-pressed="${k === brand.reward}">${REWARD_LABELS[k]}</button>`).join('')}</div></fieldset></div>`;
}
