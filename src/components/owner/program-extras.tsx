"use client";

import { useState } from "react";
import { postJson, type MeResponse } from "@/components/client-api";
import { useDirtyGuard, useOwner } from "./owner-context";
import { SaveBar, type SaveState } from "./owner-ui";
import { CARD_NEWS_MAX, CHALLENGE_VISITS, cardNewsProblem, EXCLUDED_GOODS, REVIEW_URL_MAX, reviewUrlValid } from "@/lib/card-extras";
import { expiryRuleText, POINTS_EXPIRY_MONTHS } from "@/lib/points-expiry-rules";

type Draft = { welcomeBonus: string; cardNews: string; reviewUrl: string; expiryMonths: string; challengeVisits: string; challengeBonus: string };
const fromMe = (me: MeResponse): Draft => ({ welcomeBonus: String(me.welcomeBonus ?? 0), cardNews: me.cardNews ?? "", reviewUrl: me.reviewUrl ?? "", expiryMonths: String(me.pointsExpiryMonths ?? ""), challengeVisits: String(me.challengeVisits ?? ""), challengeBonus: String(me.challengeBonus || 1) });
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
  const changed = (Object.keys(draft) as Array<keyof Draft>).some(key => draft[key] !== saved[key]);
  const shown: SaveState = state === "saving" || state === "error" ? state : changed ? "dirty" : state === "saved" ? "saved" : "clean";
  useDirtyGuard("program-extras", changed);

  function edit(patch: Partial<Draft>) { setDraft(current => ({ ...current, ...patch })); if (state === "saved" || state === "error") setState("clean"); }

  async function save() {
    if (!me.programId) return;
    setState("saving"); setError("");
    try {
      await postJson("/api/merchant/program/extras", { programId: me.programId, welcomeBonus: bonus, cardNews: draft.cardNews.trim(), reviewUrl: draft.reviewUrl.trim(), ...(stamp ? {} : { pointsExpiryMonths: draft.expiryMonths ? Number(draft.expiryMonths) : null }), challengeVisits: draft.challengeVisits ? Number(draft.challengeVisits) : null, ...(draft.challengeVisits ? { challengeBonus } : {}) });
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
        <span id="extras-challenge-hint" className={challengeValid ? "ow-hint" : "ow-error"}>{challengeValid ? `Zählt Tage mit einem an der Kasse bestätigten Besuch im Kalendermonat. Der Bonus wird einmal pro Monat mit dem bestätigten Besuch gebucht, der das Ziel erreicht; die Kasse sieht ihn. ${stamp ? "1 bis 3 Stempel." : "Höchstens ein Viertel der günstigsten Prämie."} ${EXCLUDED_GOODS}` : stamp ? "Bonus: 1 bis 3 Stempel." : "Bonus: mindestens 1 Punkt."}</span>
      </fieldset>
      <SaveBar state={shown} onSave={() => void save()} onDiscard={() => { setDraft(saved); setState("clean"); }} canSave={changed && bonusValid && !newsProblem && reviewValid && challengeValid} saveLabel="Speichern" detail={shown === "error" ? `${error} Deine Änderungen sind noch da.` : undefined} />
    </section>
  );
}
