"use client";

import { useState } from "react";
import { postJson, type MeResponse, type PublicProgram } from "@/components/client-api";
import { useDirtyGuard, useOwner } from "./owner-context";
import { Notice, OwnerDialog, Skeleton } from "./owner-ui";
import { euro, minimumSpendMinor, MIN_SPEND_LABEL, NO_MIN_SPEND_LABEL, parseGermanMoney, parseWholeNumber, unitDative, unitName } from "./program-helpers";
import { useLoad } from "./use-load";

type Reward = { rewardId: string; versionId: string; version: number; title: string; cost: number; termsText: string; sortOrder: number; active: boolean };
type Form = { id: string | null; title: string; cost: string; terms: string; ownCost: string };
const EMPTY: Form = { id: null, title: "", cost: "", terms: "", ownCost: "" };

export function RewardsCard({ me, program, onChanged }: { me: MeResponse; program: PublicProgram; onChanged: () => void | Promise<void> }) {
  const owner = useOwner();
  const [list, reload] = useLoad<{ rewards: Reward[] }>(`/api/merchant/program/rewards?programSlug=${encodeURIComponent(me.programSlug)}`);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [archiving, setArchiving] = useState<Reward | null>(null);
  const [notice, setNotice] = useState("");
  const type = program.programType;
  const unit = unitName(type);
  const purchase = type === "points" && program.earningMode === "purchase";
  const rate = program.pointsPerCurrencyUnit ?? 1;
  const active = list.state === "ok" ? list.data.rewards.filter(reward => reward.active) : [];
  const archived = list.state === "ok" ? list.data.rewards.filter(reward => !reward.active) : [];
  const original = form?.id ? active.find(reward => reward.rewardId === form.id) : undefined;
  const dirty = Boolean(form && (form.id ? original && (form.title !== original.title || form.cost !== String(original.cost) || form.terms !== original.termsText) : form.title || form.cost || form.terms));
  useDirtyGuard("program-rewards", dirty);

  const cost = form ? parseWholeNumber(form.cost) : null;
  const titleValid = Boolean(form && form.title.trim().length >= 2);
  const valid = titleValid && cost !== null;

  async function run(payload: object, done: string): Promise<boolean> {
    setBusy(true); setError(""); setNotice("");
    try {
      await postJson("/api/merchant/program/rewards", { programSlug: me.programSlug, ...payload });
      reload(); await onChanged(); void owner.refresh();
      setNotice(done); owner.announce(done);
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Die Prämie konnte nicht gespeichert werden."); return false; }
    finally { setBusy(false); }
  }
  async function submit() {
    if (!form || !valid || busy || cost === null) return;
    const ok = await run({ action: form.id ? "edit" : "create", ...(form.id ? { rewardId: form.id } : {}), title: form.title.trim(), cost, termsText: form.terms.trim() }, form.id ? "Neue Prämienversion gespeichert." : "Prämie hinzugefügt.");
    if (ok) setForm(null);
  }
  async function move(index: number, direction: -1 | 1) {
    const next = [...active]; const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await run({ action: "reorder", rewardIds: next.map(reward => reward.rewardId) }, "Reihenfolge gespeichert.");
  }

  // Effect of the pending edit, shown before anything is saved.
  const effect: string[] = [];
  if (form && original && cost !== null) {
    if (cost < original.cost) effect.push(`Der Preis sinkt von ${original.cost} auf ${cost} ${unit}. Karten mit mindestens ${cost} ${unit} können die Prämie ab dem Speichern einlösen.`);
    if (cost > original.cost) effect.push(`Der Preis steigt von ${original.cost} auf ${cost} ${unit}. Kunden brauchen ab dem Speichern mehr; gesammelte Stände bleiben unverändert.`);
    if (form.title.trim() !== original.title) effect.push(`Der Name ändert sich von „${original.title}“ zu „${form.title.trim()}“.`);
    if (form.terms.trim() !== original.termsText.trim()) effect.push("Die Bedingungen ändern sich.");
    if (effect.length) effect.push(`Speichern legt Version ${original.version + 1} an. Bereits eingelöste Prämien behalten ihre bisherige Version.`);
  }
  const min = purchase && cost !== null ? minimumSpendMinor(cost, rate) : null;
  const ownCost = form ? parseGermanMoney(form.ownCost) : null;

  return (
    <section className="ow-card ow-stack" aria-labelledby="rew-title" style={{ gap: 16 }}>
      <div className="ow-card-head" style={{ marginBottom: 0 }}>
        <div><h2 id="rew-title">Prämien</h2><p>Reihenfolge wie bei Anmeldung und Kasse. Jede Prämie: Name, Preis in {unitDative(type)}, Bedingungen.</p></div>
        {!form && <button type="button" className="ow-btn ow-btn--secondary" onClick={() => { setForm({ ...EMPTY }); setError(""); setNotice(""); }}>Prämie hinzufügen</button>}
      </div>
      {notice && <div role="status"><Notice tone="ok">{notice}</Notice></div>}
      {list.state === "loading" && <div className="ow-stack"><Skeleton height={64} /><Skeleton height={64} /></div>}
      {list.state === "error" && <Notice tone="danger" role="alert" actions={<button type="button" className="ow-btn ow-btn--sm ow-btn--secondary" onClick={reload}>Erneut laden</button>}>{list.message}</Notice>}
      {list.state === "ok" && active.length === 0 && !form && <div className="ow-empty"><strong>Noch keine aktive Prämie.</strong>Ohne Prämie können Kunden nichts einlösen.</div>}
      {list.state === "ok" && active.length > 0 && (
        <ol className="ow-rewards" aria-label="Aktive Prämien">
          {active.map((reward, index) => {
            const spend = purchase ? minimumSpendMinor(reward.cost, rate) : null;
            return (
              <li key={reward.rewardId} className="ow-reward">
                <div className="ow-reward-main">
                  <strong>{reward.title}</strong>
                  <span className="ow-num">{reward.cost} {unit}</span>
                  {reward.termsText && <span className="ow-muted">{reward.termsText}</span>}
                  <span className="ow-hint">{spend !== null ? `Ab ${euro(spend, program.currency)} Einkaufswert erreichbar. ${MIN_SPEND_LABEL}` : NO_MIN_SPEND_LABEL}</span>
                </div>
                <div className="ow-reward-actions">
                  <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" disabled={busy || index === 0} onClick={() => void move(index, -1)} aria-label={`${reward.title} nach oben`}>↑</button>
                  <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" disabled={busy || index === active.length - 1} onClick={() => void move(index, 1)} aria-label={`${reward.title} nach unten`}>↓</button>
                  <button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" disabled={busy} onClick={() => { setForm({ id: reward.rewardId, title: reward.title, cost: String(reward.cost), terms: reward.termsText, ownCost: "" }); setError(""); setNotice(""); }}>Bearbeiten</button>
                  <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" disabled={busy || active.length <= 1} title={active.length <= 1 ? "Mindestens eine aktive Prämie ist nötig." : undefined} onClick={() => setArchiving(reward)}>Archivieren</button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {form && (
        <form className="ow-card ow-card--flat ow-stack" style={{ background: "var(--ow-surface-2)" }} aria-labelledby="rew-form-title" onSubmit={event => { event.preventDefault(); void submit(); }}>
          <h3 id="rew-form-title" style={{ fontSize: 16 }}>{form.id ? "Prämie bearbeiten" : "Neue Prämie"}</h3>
          <div className="ow-field"><label htmlFor="rew-title-input">Name der Prämie</label><input id="rew-title-input" className="ow-input" value={form.title} maxLength={180} onChange={event => setForm({ ...form, title: event.target.value })} aria-invalid={form.title.length > 0 && !titleValid} placeholder="z. B. Kaffee aufs Haus" /></div>
          <div className="ow-field"><label htmlFor="rew-cost">Preis in {unitDative(type)}</label><input id="rew-cost" className="ow-input" inputMode="numeric" value={form.cost} onChange={event => setForm({ ...form, cost: event.target.value.replace(/[^0-9]/g, "") })} aria-invalid={form.cost.length > 0 && cost === null} aria-describedby="rew-cost-hint" style={{ maxWidth: 200 }} /><span id="rew-cost-hint" className="ow-hint">{type === "stamp" ? "So viele Stempel muss eine Karte sammeln." : purchase ? `So viele Punkte werden benötigt. Bei ${rate} ${unitName("points", rate)} pro 1 € entspricht das einem Mindestumsatz.` : "So viele Punkte werden benötigt."}</span></div>
          <div className="ow-field"><label htmlFor="rew-terms">Bedingungen (optional)</label><textarea id="rew-terms" className="ow-textarea" style={{ minHeight: 72 }} value={form.terms} maxLength={3000} onChange={event => setForm({ ...form, terms: event.target.value })} placeholder="z. B. Gültig Mo–Fr bis 11 Uhr." /></div>
          {cost !== null && (
            <div className="ow-readonly" role="status" aria-live="polite">
              {min !== null ? <>Mindestumsatz für diese Prämie: <strong>{euro(min, program.currency)}</strong>. {MIN_SPEND_LABEL}</> : NO_MIN_SPEND_LABEL + "."}
              {purchase && min !== null && (
                <div className="ow-field" style={{ marginTop: 10 }}>
                  <label htmlFor="rew-own" className="ow-hint">Rechenhilfe: Deine Kosten für diese Prämie in € (optional, wird nicht gespeichert)</label>
                  <input id="rew-own" className="ow-input" inputMode="decimal" placeholder="z. B. 1,80" value={form.ownCost} onChange={event => setForm({ ...form, ownCost: event.target.value })} style={{ maxWidth: 200 }} />
                  {ownCost !== null ? <span className="ow-hint">Das entspricht rund {((ownCost / (min / 100)) * 100).toFixed(1).replace(".", ",")} % des Mindestumsatzes. Nur eine Rechenhilfe, keine Empfehlung.</span> : form.ownCost ? <span className="ow-error">Bitte einen Betrag wie 1,80 eingeben.</span> : null}
                </div>
              )}
            </div>
          )}
          {effect.length > 0 && <Notice tone="info"><strong>Das ändert sich beim Speichern</strong><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{effect.map(line => <li key={line}>{line}</li>)}</ul></Notice>}
          {error && <p className="ow-error" role="alert">{error} Deine Eingaben sind noch da.</p>}
          <div className="ow-row"><button type="submit" className="ow-btn ow-btn--primary" disabled={!valid || busy || (Boolean(form.id) && !dirty)} aria-busy={busy}>{busy ? "Speichern …" : form.id ? "Prämienversion speichern" : "Prämie hinzufügen"}</button><button type="button" className="ow-btn ow-btn--ghost" disabled={busy} onClick={() => { setForm(null); setError(""); }}>Abbrechen</button></div>
        </form>
      )}
      {error && !form && <p className="ow-error" role="alert">{error}</p>}
      {archived.length > 0 && <details className="ow-muted"><summary>Archivierte Prämien ({archived.length})</summary><ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{archived.map(reward => <li key={reward.rewardId}>{reward.title} · Version {reward.version}</li>)}</ul></details>}
      {archiving && (
        <OwnerDialog title={`„${archiving.title}“ archivieren?`} tone="danger" onClose={() => setArchiving(null)} actions={<><button type="button" className="ow-btn ow-btn--secondary" data-autofocus onClick={() => setArchiving(null)}>Abbrechen</button><button type="button" className="ow-btn ow-btn--danger" disabled={busy} onClick={() => { const target = archiving; setArchiving(null); void run({ action: "archive", rewardId: target.rewardId }, `„${target.title}“ archiviert.`); }}>Archivieren</button></>}>
          <p>Kunden sehen die Prämie danach nicht mehr und können sie nicht mehr einlösen. Bereits eingelöste Prämien bleiben in der Historie.</p>
        </OwnerDialog>
      )}
    </section>
  );
}
