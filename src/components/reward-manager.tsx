"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiJson, postJson } from "./client-api";

type MerchantReward = { rewardId: string; versionId: string; version: number; title: string; cost: number; termsText: string; sortOrder: number; active: boolean };

export function RewardManager({ programSlug, programType, onChanged }: { programSlug: string; programType: "stamp" | "points"; currency: string; onChanged: () => void | Promise<void> }) {
  const [rewards, setRewards] = useState<MerchantReward[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [title, setTitle] = useState("");
  const [cost, setCost] = useState(0);
  const [termsText, setTermsText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [archiveId, setArchiveId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await apiJson<{ rewards: MerchantReward[] }>(`/api/merchant/program/rewards?programSlug=${encodeURIComponent(programSlug)}`);
    setRewards(result.rewards);
  }, [programSlug]);
  useEffect(() => {
    let active = true;
    void apiJson<{ rewards: MerchantReward[] }>(`/api/merchant/program/rewards?programSlug=${encodeURIComponent(programSlug)}`)
      .then(result => { if (active) setRewards(result.rewards); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Prämien konnten nicht geladen werden."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [programSlug]);

  async function mutate(payload: object, message: string): Promise<boolean> {
    setBusy(true); setError(""); setSuccess("");
    try {
      await postJson("/api/merchant/program/rewards", { programSlug, ...payload });
      await refresh();
      await onChanged();
      setSuccess(message);
      setEditingId(null); setArchiveId(null);
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Prämie konnte nicht gespeichert werden."); return false; }
    finally { setBusy(false); }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await mutate({ action: "create", title: title.trim(), cost, termsText: termsText.trim() }, "Prämie hinzugefügt.")) {
      setTitle(""); setCost(0); setTermsText("");
    }
  }

  function beginEdit(reward: MerchantReward) {
    setEditingId(reward.rewardId); setArchiveId(null); setTitle(reward.title); setCost(reward.cost); setTermsText(reward.termsText);
    setError(""); setSuccess("");
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId) return;
    if (await mutate({ action: "edit", rewardId: editingId, title: title.trim(), cost, termsText: termsText.trim() }, "Neue Prämienversion gespeichert.")) {
      setTitle(""); setCost(0); setTermsText("");
    }
  }

  function cancelEdit() { setEditingId(null); setTitle(""); setCost(0); setTermsText(""); }

  const active = rewards.filter(reward => reward.active);
  const archived = rewards.filter(reward => !reward.active);
  const unit = programType === "stamp" ? "Stempel" : "Punkte";

  async function move(index: number, direction: -1 | 1) {
    const next = [...active];
    const swap = index + direction;
    if (swap < 0 || swap >= next.length) return;
    [next[index], next[swap]] = [next[swap], next[index]];
    await mutate({ action: "reorder", rewardIds: next.map(reward => reward.rewardId) }, "Prämienreihenfolge gespeichert.");
  }

  return <section className="app-panel reward-manager"><div className="panel-head"><span className="step-number">★</span><div><h2>Prämien verwalten</h2><p>Aktive Prämien erscheinen in dieser Reihenfolge bei Anmeldung und an der Kasse.</p></div></div>
    {loading ? <p>Prämien werden geladen …</p> : <div className="reward-manager-list">{active.map((reward, index) => <div className="reward-manager-row" key={reward.rewardId}><div><strong>{reward.title}</strong><span>{reward.cost} {unit}{reward.termsText ? ` · ${reward.termsText}` : ""}</span></div><div className="reward-manager-actions"><button type="button" disabled={busy || index === 0} onClick={() => void move(index, -1)} aria-label={`${reward.title} nach oben`}>Nach oben</button><button type="button" disabled={busy || index === active.length - 1} onClick={() => void move(index, 1)} aria-label={`${reward.title} nach unten`}>Nach unten</button><button type="button" disabled={busy} onClick={() => beginEdit(reward)}>Prämie bearbeiten</button><button type="button" disabled={busy || active.length <= 1} onClick={() => { setArchiveId(reward.rewardId); setEditingId(null); }}>Prämie archivieren</button></div>{archiveId === reward.rewardId && <div className="reward-archive-confirm"><p>„{reward.title}“ wird für künftige Einlösungen entfernt. Frühere Einlösungen und Prämienversionen bleiben erhalten.</p><button type="button" className="button button--outline" onClick={() => setArchiveId(null)}>Abbrechen</button><button type="button" className="button button--ink" disabled={busy} onClick={() => void mutate({ action: "archive", rewardId: reward.rewardId }, "Prämie archiviert.")}>Archivierung bestätigen</button></div>}</div>)}</div>}
    <form className="program-edit-form reward-manager-form" onSubmit={editingId ? saveEdit : add}><h3>{editingId ? "Prämie bearbeiten" : "Prämie hinzufügen"}</h3><div className="field-grid"><label>Prämientitel<input value={title} onChange={event => setTitle(event.target.value)} minLength={2} maxLength={180} required /></label><label>Benötigte {unit}<input type="number" value={cost || ""} onChange={event => setCost(Number(event.target.value))} min={1} max={100000} step={1} required /></label><label className="field-wide">Prämienbedingungen <span className="optional">optional</span><textarea value={termsText} onChange={event => setTermsText(event.target.value)} maxLength={3000} rows={2} /></label></div><div className="reward-manager-form-actions"><button type="submit" className="button button--ink" disabled={busy || (!editingId && active.length >= 100)}>{busy ? "Wird gespeichert …" : editingId ? "Neue Prämienversion speichern" : "Prämie hinzufügen"}</button>{editingId && <button type="button" className="button button--outline" onClick={cancelEdit}>Abbrechen</button>}</div></form>
    {active.length >= 100 && <p role="status">Das Limit von 100 aktiven Prämien ist erreicht.</p>}
    {archived.length > 0 && <details className="reward-archive-list"><summary>Archivierte Prämien ({archived.length})</summary><ul>{archived.map(reward => <li key={reward.rewardId}>{reward.title} · Version {reward.version}</li>)}</ul></details>}
    {error && <p className="inline-message inline-message--error" role="alert">{error}</p>}{success && <p className="inline-message inline-message--success" role="status">{success}</p>}
  </section>;
}
