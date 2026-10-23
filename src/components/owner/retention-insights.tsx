"use client";

import Link from "next/link";
import type { MeResponse } from "@/components/client-api";
import type { RetentionSummary } from "@/lib/retention";
import { retentionCustomerHref } from "@/lib/retention-links";
import { nf, Notice, Skeleton, OwnerIcon } from "./owner-ui";
import type { Loadable } from "./use-load";
import { EmptyState } from "@/components/ui/empty-state";

export type ReferralRow = { status: string };
export type Insight = { id: string; tone: "act" | "watch"; title: string; why: string; actions: Array<{ label: string; href: string }> };

const cards = (n: number) => `${nf.format(n)} ${n === 1 ? "Karte" : "Karten"}`;

/**
 * Deterministic observations from recorded data, each with the rule that produced it and a real next step.
 * Campaign links appear only where the campaigns surface is offered and the viewer is the owner.
 */
export function buildInsights(input: { summary: RetentionSummary; unit: string; isOwner: boolean; campaigns: boolean; referrals: ReferralRow[] | null }): Insight[] {
  const { summary: s, unit, isOwner, campaigns, referrals } = input;
  const days = s.inactiveDays;
  const draft = isOwner && campaigns && s.programCount === 1;
  const list: Insight[] = [];
  const review = referrals?.filter(row => row.status === "review").length ?? 0;
  if (review > 0) list.push({ id: "referral-review", tone: "act", title: `${nf.format(review)} ${review === 1 ? "Empfehlung braucht" : "Empfehlungen brauchen"} deine Prüfung`,
    why: "Loynara hat einen Bonus angehalten, zum Beispiel weil beide Karten dieselbe E-Mail-Adresse nutzen. Ohne deine Entscheidung wird nichts gutgeschrieben.",
    actions: [{ label: "Empfehlungen prüfen", href: "/merchant/referrals" }] });
  if (s.rewardReady > 0) list.push({ id: "reward-ready", tone: "act", title: `${cards(s.rewardReady)} ${s.rewardReady === 1 ? "kann" : "können"} jetzt eine Prämie einlösen`,
    why: "Der Kartenstand reicht schon für die günstigste aktive Prämie. Dein Team kann sie beim nächsten Besuch aktiv anbieten.",
    actions: [{ label: "Karten ansehen", href: retentionCustomerHref(s, "reward_ready") }] });
  if (s.drifting > 0) {
    const trend = s.driftingWeekAgo === s.drifting ? "Gleich viele wie vor einer Woche." : s.driftingWeekAgo < s.drifting ? `Vor einer Woche waren es ${nf.format(s.driftingWeekAgo)}.` : `Vor einer Woche waren es noch ${nf.format(s.driftingWeekAgo)}.`;
    list.push({ id: "drifting", tone: "act", title: `${cards(s.drifting)} seit über ${days} Tagen ohne bestätigte Buchung`,
      why: `Diese Karten hatten schon bestätigte Buchungen, aber keine in den letzten ${days} Tagen. ${trend} Warum, wissen wir nicht.`,
      actions: [{ label: "Karten ansehen", href: retentionCustomerHref(s, "drifting") }, ...(draft ? [{ label: "Rückhol-Aktion vorbereiten", href: `/merchant/campaigns?goal=winback&days=${days}` }] : [])] });
  }
  if (s.nearReward > 0) {
    const gap = s.nearRewardMaxRemaining;
    list.push({ id: "near-reward", tone: "watch", title: `${cards(s.nearReward)} ${s.nearReward === 1 ? "ist" : "sind"} kurz vor einer Prämie`,
      why: gap ? `Es fehlen höchstens ${gap} ${unit}. Den aktuellen Prämienstand kann dein Team beim nächsten Mal an der Kasse ansprechen.` : "Es fehlt höchstens ein Viertel bis zur günstigsten Prämie, auf ganze Einheiten aufgerundet.",
      actions: [{ label: "Karten ansehen", href: retentionCustomerHref(s, "near_reward") }, ...(draft && gap && s.nearRewardId ? [{ label: "Erinnerung vorbereiten", href: `/merchant/campaigns?goal=near-reward&maxRemaining=${gap}&rewardId=${encodeURIComponent(s.nearRewardId!)}` }] : [])] });
  }
  if (s.neverAfterWeek > 0) list.push({ id: "never", tone: "watch", title: `${cards(s.neverAfterWeek)} seit über einer Woche angemeldet, aber nie an der Kasse bestätigt`,
    why: "Für diese Karten ist noch keine bestätigte Buchung erfasst. Nicht erfasste Besuche und die Gründe dafür sind unbekannt.",
    actions: [{ label: "Karten ansehen", href: retentionCustomerHref(s, "never", 7) }] });
  const waiting = referrals?.filter(row => row.status === "pending").length ?? 0;
  if (waiting > 0) list.push({ id: "referral-waiting", tone: "watch", title: `${nf.format(waiting)} ${waiting === 1 ? "geworbene Karte wartet" : "geworbene Karten warten"} auf die erste bestätigte Buchung`,
    why: "Geteilt und angemeldet ist noch kein Erfolg. Der Bonus fließt erst, wenn die neue Karte an deiner Kasse bestätigt wird.",
    actions: [{ label: "Empfehlungen ansehen", href: "/merchant/referrals" }] });
  return list;
}

export function CardBase({ summary }: { summary: RetentionSummary }) {
  const total = summary.openCards;
  const parts = [
    { key: "recent", label: `Aktiv in ${summary.inactiveDays} Tagen`, value: summary.recent, className: "ow-base-seg--recent" },
    { key: "drifting", label: "Länger nicht da", value: summary.drifting, className: "ow-base-seg--drifting" },
    { key: "never", label: "Noch nie an der Kasse", value: summary.never, className: "ow-base-seg--never" },
  ];
  return (
    <div className="ow-base">
      <div className="ow-base-bar" role="img" aria-label={`${cards(total)}: ${parts.map(part => `${nf.format(part.value)} ${part.label}`).join(", ")}`}>
        {total > 0 && parts.filter(part => part.value > 0).map(part => <span key={part.key} className={`ow-base-seg ${part.className}`} style={{ flexGrow: part.value }} />)}
      </div>
      <ul className="ow-base-legend">
        {parts.map(part => <li key={part.key}><span className={`ow-base-dot ${part.className}`} aria-hidden="true" /><strong className="ow-num">{nf.format(part.value)}</strong> {part.label}</li>)}
      </ul>
    </div>
  );
}

/** skipFirst: the Übersicht already shows the first insight as "Als Nächstes". */
export function RetentionInsights({ me, summary, referrals, reload, skipFirst = false }: { me: MeResponse; summary: Loadable<RetentionSummary>; referrals: ReferralRow[] | null; reload: () => void; skipFirst?: boolean }) {
  const isOwner = me.role === "owner";
  const campaigns = !(me.hiddenSurfaces ?? []).includes("campaigns");
  const unit = me.programType === "points" ? "Punkte" : "Stempel";
  const all = summary.state === "ok" ? buildInsights({ summary: summary.data, unit, isOwner, campaigns, referrals }) : [];
  const insights = all.slice(skipFirst ? 1 : 0);
  return (
    <section className="ow-card" aria-labelledby="ow-insight-title" aria-busy={summary.state === "loading"}>
      <div className="ow-card-head"><div><h2 id="ow-insight-title">Was jetzt zählt</h2><p>Berechnet aus bestätigten Buchungen. Jede Zeile nennt ihre Regel.</p></div></div>
      {(summary.state === "loading" || summary.state === "idle") && <div className="ow-stack"><Skeleton height={44} /><Skeleton height={88} /><Skeleton height={88} /></div>}
      {summary.state === "error" && <Notice tone="warn" actions={<button type="button" className="ow-btn ow-btn--sm ow-btn--secondary" onClick={reload}>Erneut laden</button>}>Der Kartenbestand konnte gerade nicht berechnet werden. Das heißt nicht, dass niemand betroffen ist.</Notice>}
      {summary.state === "ok" && (
        <div className="ow-stack" style={{ gap: 16 }}>
          <div><h3 className="ow-label" style={{ marginBottom: 8 }}>Kartenbestand · {cards(summary.data.openCards)}</h3><CardBase summary={summary.data} /></div>
          {all.length === 0
            ? <EmptyState level={3} icon={<OwnerIcon name="check" size={24} />} title={me.cancellationEndDate ? "Sonst ist nichts offen." : "Gerade nichts Dringendes."}>Geprüft: verdiente Prämien, Karten ohne bestätigte Buchung seit {summary.data.inactiveDays} Tagen, Karten kurz vor der Prämie und Anmeldungen ohne Buchung.</EmptyState>
            : insights.length > 0 && <ul className="ow-insights">{insights.map((item, index) => (
              <li key={item.id} className={`ow-action${index === 0 ? " ow-action--lead" : ""}`} data-tone={item.tone}>
                <h3>{item.title}</h3><p>{item.why}</p>
                <div className="ow-row">{item.actions.map((action, actionIndex) => <Link key={action.href} className={`ow-btn ow-btn--sm ${index === 0 && actionIndex === item.actions.length - 1 ? "ow-btn--primary" : "ow-btn--secondary"}`} href={action.href}>{action.label}</Link>)}</div>
              </li>))}</ul>}
        </div>
      )}
    </section>
  );
}
