"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { postJson, type PublicProgram } from "@/components/client-api";
import { useOwner } from "./owner-context";
import { Notice } from "./owner-ui";
import { longDay, unitName } from "./program-helpers";
import { useLoad } from "./use-load";

/** „Reihenfolge ändern“: the rewards in the order of the join page and the counter, each move saved at once. Each reward's
 *  own page (03, program-reward.tsx) changes its cost, name or archive. */
export function RewardOrder({ slug, program, onChanged }: { slug: string; program: PublicProgram; onChanged: () => void | Promise<void> }) {
  const owner = useOwner();
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const rewards = program.rewards;

  async function move(index: number, direction: -1 | 1) {
    const next = [...rewards], target = index + direction;
    [next[index], next[target]] = [next[target], next[index]];
    setBusy(true); setError(""); setNotice("");
    try {
      await postJson("/api/merchant/program/rewards", { programSlug: slug, action: "reorder", rewardIds: next.map(reward => reward.rewardId) });
      await onChanged();
      setNotice("Reihenfolge gespeichert."); owner.announce("Reihenfolge gespeichert.");
    } catch { setError("Die Reihenfolge konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }

  return (
    <section className="ow-card ow-stack" aria-label="Reihenfolge der Prämien" style={{ gap: 16 }}>
      <p className="ow-muted">So stehen die Prämien bei der Anmeldung, auf der Karte und an der Kasse. Die oberste zeigt die Karte als Ziel an, auch in der Wallet.</p>
      {notice && <div role="status"><Notice tone="ok">{notice}</Notice></div>}
      {error && <p className="ow-error" role="alert">{error}</p>}
      <ol className="ow-rewards" aria-label="Prämien">
        {rewards.map((reward, index) => (
          <li key={reward.rewardId} className="ow-reward">
            <div className="ow-reward-head">
              <div className="ow-reward-main"><strong>{reward.title}</strong><span className="ow-num">{reward.cost} {unitName(program.programType, reward.cost)}</span></div>
              <div className="ow-reward-move">
                <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" disabled={busy || index === 0} onClick={() => void move(index, -1)} aria-label={`${reward.title} nach oben`}><ArrowUp size={18} /></button>
                <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" disabled={busy || index === rewards.length - 1} onClick={() => void move(index, 1)} aria-label={`${reward.title} nach unten`}><ArrowDown size={18} /></button>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

type Stored = { rewardId: string; title: string; cost: number; active: boolean; endedOn: string | null };
/** „Archivierte Prämien“ (read-only, Design): name, cost and the day it ended where one is stored; archives from before
 *  ENG-100 ended at once and have no date. No restore. */
export function ArchivedRewards({ slug, program }: { slug: string; program: PublicProgram }) {
  const [list] = useLoad<{ rewards: Stored[] }>(`/api/merchant/program/rewards?programSlug=${encodeURIComponent(slug)}`);
  if (list.state !== "ok" && list.state !== "error") return null;
  if (list.state === "error") return <Notice tone="danger" role="alert">{list.message}</Notice>;
  return (
    <ul className="ow-rows" aria-label="Archivierte Prämien">
      {list.data.rewards.filter(reward => !reward.active).map(reward => (
        <li key={reward.rewardId}><div className="ow-prog-row"><span className="ow-prog-main"><span className="ow-prog-text">
          <strong>{reward.title}</strong><small>{reward.cost} {unitName(program.programType, reward.cost)}{reward.endedOn && ` · archiviert am ${longDay(reward.endedOn)}`}</small>
        </span></span></div></li>
      ))}
    </ul>
  );
}
