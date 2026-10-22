"use client";

import { useState } from "react";
import { postJson, type MeResponse } from "@/components/client-api";
import { useDirtyGuard, useOwner } from "./owner-context";
import { SaveBar, type SaveState } from "./owner-ui";
import { CARD_NEWS_MAX, CHALLENGE_VISITS, cardNewsProblem, EXCLUDED_GOODS, LEVEL_PERK_MAX, levelPerkProblem, REVIEW_URL_MAX, reviewUrlValid } from "@/lib/card-extras";
import { expiryRuleText, POINTS_EXPIRY_MONTHS } from "@/lib/points-expiry-rules";
import { parsePurchaseAmountMinor } from "@/lib/points";
import { AVERAGE_VISIT_SPEND_MAX_MINOR, SPEND_COPY } from "@/lib/spend-copy";

type Draft = { welcomeBonus: string; cardNews: string; reviewUrl: string; expiryMonths: string; challengeVisits: string; challengeBonus: string; levelsEnabled: boolean; silver: string; gold: string; perkBronze: string; perkSilber: string; perkGold: string; averageSpend: string };
const LEVELS = [["Bronze", "perkBronze"], ["Silber", "perkSilber"], ["Gold", "perkGold"]] as const;
const fromMe = (me: MeResponse): Draft => ({ welcomeBonus: String(me.welcomeBonus ?? 0), cardNews: me.cardNews ?? "", reviewUrl: me.reviewUrl ?? "", expiryMonths: String(me.pointsExpiryMonths ?? ""), challengeVisits: String((me.challengeNext ? me.challengeNext.visits : me.challengeVisits) ?? ""), challengeBonus: String((me.challengeNext?.bonus ?? me.challengeBonus) || 1),
  levelsEnabled: me.levelsEnabled ?? false, silver: String(me.levelSilverVisits ?? ""), gold: String(me.levelGoldVisits ?? ""), perkBronze: me.levelBronzePerk ?? "", perkSilber: me.levelSilverPerk ?? "", perkGold: me.levelGoldPerk ?? "", averageSpend: me.averageVisitSpendMinor ? `${Math.floor(me.averageVisitSpendMinor / 100)},${String(me.averageVisitSpendMinor % 100).padStart(2, "0")}` : "" });
const averageMinor = (text: string) => { try { const minor = parsePurchaseAmountMinor(text); return minor <= AVERAGE_VISIT_SPEND_MAX_MINOR ? minor : undefined; } catch { return undefined; } };
const NEWS_PROBLEM = { TOO_LONG: `Höchstens ${CARD_NEWS_MAX} Zeichen.`, LINK: "Bitte ohne Links oder Webadressen.", CONTROL: "Bitte in einer Zeile, ohne Zeilenumbruch." };

/** Programme extras the owner sets outside the versioned earning rule. The server checks every value again. */
export function ProgramExtrasCard({ me }: { me: MeResponse }) {
  const owner = useOwner();
  const [saved, setSaved] = useState<Draft>(() => fromMe(me));
  const [draft, setDraft] = useState<Draft>(saved);
  const [state, setState] = useState<SaveState>("clean");
  const [error, setError] = useState("");
  const stamp = me.programType === "stamp";
  const maxBonus = stamp ? 3 : 50;
  const bonus = Number(draft.welcomeBonus);
  const bonusValid = /^\d+$/.test(draft.welcomeBonus) && bonus <= maxBonus;
  const newsProblem = cardNewsProblem(draft.cardNews.trim());
  const reviewValid = draft.reviewUrl.trim() === "" || reviewUrlValid(draft.reviewUrl.trim());
  const challengeBonus = Number(draft.challengeBonus);
  // The points maximum depends on the cheapest reward; the server checks it and names the limit.
  const challengeValid = !draft.challengeVisits || (/^\d+$/.test(draft.challengeBonus) && challengeBonus >= 1 && (!stamp || challengeBonus <= 3));
  const silver = Number(draft.silver), gold = Number(draft.gold);
  // No default thresholds (Product): switching levels on needs both; once typed they must make sense even while off.
  const levelsValid = (!draft.levelsEnabled || (draft.silver !== "" && draft.gold !== "")) && (draft.silver === "" || (silver >= 2 && silver <= 50)) && (draft.gold === "" || (gold <= 90 && (draft.silver === "" || gold > silver))) && LEVELS.every(([, key]) => !levelPerkProblem(draft[key].trim()));
  const average = draft.averageSpend.trim() ? averageMinor(draft.averageSpend) : null;
  const averageValid = !stamp || average !== undefined;
  const changed = (Object.keys(draft) as Array<keyof Draft>).some(key => draft[key] !== saved[key]);
  const shown: SaveState = state === "saving" || state === "error" ? state : changed ? "dirty" : state === "saved" ? "saved" : "clean";
  useDirtyGuard("program-extras", changed);

  function edit(patch: Partial<Draft>) { setDraft(current => ({ ...current, ...patch })); if (state === "saved" || state === "error") setState("clean"); }

  async function save() {
    if (!me.programId) return;
    setState("saving"); setError("");
    try {
      await postJson("/api/merchant/program/extras", { programId: me.programId, welcomeBonus: bonus, cardNews: draft.cardNews.trim(), reviewUrl: draft.reviewUrl.trim(), ...(stamp ? {} : { pointsExpiryMonths: draft.expiryMonths ? Number(draft.expiryMonths) : null }), challengeVisits: draft.challengeVisits ? Number(draft.challengeVisits) : null, ...(draft.challengeVisits ? { challengeBonus } : {}),
        levelsEnabled: draft.levelsEnabled, ...(draft.silver ? { levelSilverVisits: silver } : {}), ...(draft.gold ? { levelGoldVisits: gold } : {}), levelBronzePerk: draft.perkBronze.trim(), levelSilverPerk: draft.perkSilber.trim(), levelGoldPerk: draft.perkGold.trim(), ...(stamp ? { averageVisitSpendMinor: average } : {}) });
      const next = { ...draft, cardNews: draft.cardNews.trim(), reviewUrl: draft.reviewUrl.trim() };
      setSaved(next); setDraft(next); setState("saved"); void owner.refresh();
    } catch (cause) { setState("error"); setError(cause instanceof Error ? cause.message : "Die Einstellungen konnten nicht gespeichert werden."); }
  }

  return (
    <section className="ow-card ow-stack" aria-labelledby="extras-title">
      <div className="ow-card-head" style={{ marginBottom: 0 }}><div><h2 id="extras-title">Auf der Kundenkarte</h2><p>Kleine Extras für neue und wiederkommende Gäste.</p></div></div>
      <div className="ow-field">
        <label htmlFor="extras-bonus">Startbonus ({stamp ? "Stempel" : "Punkte"})</label>
        <input id="extras-bonus" className="ow-input" inputMode="numeric" style={{ maxWidth: 200 }} value={draft.welcomeBonus} onChange={event => edit({ welcomeBonus: event.target.value.replace(/[^0-9]/g, "") })} aria-invalid={!bonusValid} aria-describedby="extras-bonus-hint" />
        <span id="extras-bonus-hint" className="ow-hint">Wird einmal pro Karte zusammen mit dem ersten bestätigten Besuch gutgeschrieben. 0 bis {maxBonus}, 0 = aus.</span>
      </div>
      <div className="ow-field">
        <label htmlFor="extras-news">Neuigkeit auf der Karte</label>
        <input id="extras-news" className="ow-input" value={draft.cardNews} maxLength={CARD_NEWS_MAX} placeholder="z. B. Ab Montag neue Öffnungszeiten: 8 bis 18 Uhr." onChange={event => edit({ cardNews: event.target.value })} aria-invalid={Boolean(newsProblem)} aria-describedby="extras-news-hint" />
        <span id="extras-news-hint" className={newsProblem ? "ow-error" : "ow-hint"}>{newsProblem ? NEWS_PROBLEM[newsProblem] : `Nur Text, keine Links, bis ${CARD_NEWS_MAX} Zeichen (${Array.from(draft.cardNews).length}/${CARD_NEWS_MAX}). Leer = nicht angezeigt.`}</span>
      </div>
      <div className="ow-field">
        <label htmlFor="extras-review">Google-Bewertungslink</label>
        <input id="extras-review" className="ow-input" type="url" inputMode="url" value={draft.reviewUrl} maxLength={REVIEW_URL_MAX} placeholder="https://g.page/r/…/review" onChange={event => edit({ reviewUrl: event.target.value })} aria-invalid={!reviewValid} aria-describedby="extras-review-hint" />
        <span id="extras-review-hint" className={reviewValid ? "ow-hint" : "ow-error"}>{reviewValid ? "Ab dem dritten bestätigten Besuch zeigt die Karte einen Link zur Bewertung, ohne Prämie. Leer = kein Link." : "Bitte einen https-Link von g.page, google.com/maps oder search.google.com/local/writereview."}</span>
      </div>
      {!stamp && <div className="ow-field">
        <label htmlFor="extras-expiry">Punkte verfallen</label>
        <select id="extras-expiry" className="ow-input" style={{ maxWidth: 260 }} value={draft.expiryMonths} onChange={event => edit({ expiryMonths: event.target.value })} aria-describedby="extras-expiry-hint">
          <option value="">Nie</option>
          {POINTS_EXPIRY_MONTHS.map(months => <option key={months} value={months}>{months} Monate nach dem Sammeln</option>)}
        </select>
        <span id="extras-expiry-hint" className="ow-hint">{draft.expiryMonths ? `Auf jeder Karte steht: „${expiryRuleText(Number(draft.expiryMonths))}“ ` : ""}Eine neue Einstellung gilt nur für Punkte, die ab dem Speichern gesammelt werden. 30 Tage vorher sehen Kunden einen Hinweis auf der Karte.</span>
      </div>}
      <fieldset className="ow-stack" style={{ border: 0, padding: 0, margin: 0 }} aria-describedby="extras-challenge-hint">
        <legend>Monats-Challenge</legend>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" }}>
          <div className="ow-field"><label htmlFor="extras-challenge-visits">Besuche im Monat</label>
            <select id="extras-challenge-visits" className="ow-input" value={draft.challengeVisits} onChange={event => edit({ challengeVisits: event.target.value })}>
              <option value="">Aus</option>
              {Array.from({ length: CHALLENGE_VISITS.max - CHALLENGE_VISITS.min + 1 }, (_, i) => CHALLENGE_VISITS.min + i).map(n => <option key={n} value={n}>{n}-mal</option>)}
            </select></div>
          {draft.challengeVisits && <div className="ow-field"><label htmlFor="extras-challenge-bonus">Bonus ({stamp ? "Stempel" : "Punkte"})</label>
            <input id="extras-challenge-bonus" className="ow-input" inputMode="numeric" style={{ maxWidth: 140 }} value={draft.challengeBonus} onChange={event => edit({ challengeBonus: event.target.value.replace(/[^0-9]/g, "") })} aria-invalid={!challengeValid} /></div>}
        </div>
        {me.challengeNext && <p className="ow-hint" role="status">Diesen Monat gilt noch: {me.challengeVisits}-mal, +{me.challengeBonus} {stamp ? "Stempel" : "Punkte"}. Gilt ab {Number(me.challengeNext.from.slice(8))}.{Number(me.challengeNext.from.slice(5, 7))}.: {me.challengeNext.visits ? `${me.challengeNext.visits}-mal, +${me.challengeNext.bonus} ${stamp ? "Stempel" : "Punkte"}` : "aus"}.</p>}
        <span id="extras-challenge-hint" className={challengeValid ? "ow-hint" : "ow-error"}>{challengeValid ? `${me.challengeVisits ? "Änderungen an der laufenden Challenge gelten ab dem 1. des nächsten Monats; dieser Monat bleibt, wie die Karte es zeigt. " : ""}Zählt Tage mit einem an der Kasse bestätigten Besuch im Kalendermonat. Der Bonus wird einmal pro Monat mit dem bestätigten Besuch gebucht, der das Ziel erreicht; die Kasse sieht ihn. ${stamp ? "1 bis 3 Stempel." : "Höchstens ein Viertel der günstigsten Prämie."} ${EXCLUDED_GOODS}` : stamp ? "Bonus: 1 bis 3 Stempel." : "Bonus: mindestens 1 Punkt."}</span>
      </fieldset>
      <fieldset className="ow-stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>Kundenlevel</legend>
        <label><input type="checkbox" role="switch" checked={draft.levelsEnabled} onChange={event => edit({ levelsEnabled: event.target.checked })} /> Level sind {draft.levelsEnabled ? "an" : "aus"}</label>
        <span className="ow-hint">Bronze ab dem ersten Besuch, Silber und Gold nach Besuchstagen in den letzten 90 Tagen. Wähle beide selbst, zum Beispiel Friseur/Barber: 3 und 6 · Pizzeria/Imbiss: 5 und 10.</span>
        <span className="ow-hint">Der Vorteil ist ein Text, den dein Team an der Kasse sieht und einlöst; gebucht wird nichts. Er muss echt sein und eingehalten werden, nie auf Tabak, Presse, Bücher, Lotto oder Handyguthaben.</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <div className="ow-field"><label htmlFor="extras-silver">Silber ab Besuchen</label><input id="extras-silver" className="ow-input" inputMode="numeric" style={{ maxWidth: 120 }} value={draft.silver} onChange={event => edit({ silver: event.target.value.replace(/[^0-9]/g, "") })} aria-invalid={!levelsValid} /></div>
          <div className="ow-field"><label htmlFor="extras-gold">Gold ab Besuchen</label><input id="extras-gold" className="ow-input" inputMode="numeric" style={{ maxWidth: 120 }} value={draft.gold} onChange={event => edit({ gold: event.target.value.replace(/[^0-9]/g, "") })} aria-invalid={!levelsValid} /></div>
        </div>
        {LEVELS.map(([name, key]) => <div key={key} className="ow-field"><label htmlFor={`extras-${key}`}>Vorteil {name} (optional)</label><input id={`extras-${key}`} className="ow-input" value={draft[key]} maxLength={LEVEL_PERK_MAX} placeholder={name === "Gold" ? "z. B. Getränk aufs Haus" : ""} onChange={event => edit({ [key]: event.target.value } as Partial<Draft>)} aria-invalid={Boolean(levelPerkProblem(draft[key].trim()))} /></div>)}
        {!levelsValid && <p className="ow-error">{draft.levelsEnabled && (!draft.silver || !draft.gold) ? "Bitte lege fest, ab wie vielen Besuchen Silber und Gold gelten." : `Silber 2 bis 50 Besuche, Gold mehr als Silber und höchstens 90. Vorteile: nur Text, keine Links, bis ${LEVEL_PERK_MAX} Zeichen.`}</p>}
      </fieldset>
      {stamp && <div className="ow-field">
        <label htmlFor="extras-average">{SPEND_COPY.averageLabel}</label>
        <input id="extras-average" className="ow-input" inputMode="decimal" style={{ maxWidth: 160 }} value={draft.averageSpend} placeholder="z. B. 12,50" onChange={event => edit({ averageSpend: event.target.value.replace(/[^0-9,.]/g, "") })} aria-invalid={!averageValid} aria-describedby="extras-average-hint" />
        <span id="extras-average-hint" className={averageValid ? "ow-hint" : "ow-error"}>{averageValid ? SPEND_COPY.averageHint : SPEND_COPY.averageError}</span>
      </div>}
      <SaveBar state={shown} onSave={() => void save()} onDiscard={() => { setDraft(saved); setState("clean"); }} canSave={changed && bonusValid && !newsProblem && reviewValid && challengeValid && levelsValid && averageValid} saveLabel="Speichern" detail={shown === "error" ? `${error} Deine Änderungen sind noch da.` : undefined} />
    </section>
  );
}
