"use client";

import type { RetentionSummary } from "@/lib/retention";
import { retentionCustomerHref } from "@/lib/retention-links";
import { nf } from "./owner-ui";

export type ReferralRow = { status: string };
/** `next`: an extra sentence for "Als Nächstes" on the Übersicht. */
export type Insight = { id: string; tone: "act" | "watch"; title: string; why: string; next?: string; actions: Array<{ label: string; href: string }> };
/** The owner's Wallet win-back (ENG-044), as the per-location read returns it: null where it is not offered or not the owner's. */
export type WinbackState = { enabled: boolean; inWindow: number } | null;
const WINBACK_HREF = "/merchant/wallet-messages#winback-title";

const cards = (n: number) => `${nf.format(n)} ${n === 1 ? "Karte" : "Karten"}`;

/**
 * Deterministic observations from recorded data, each with the rule that produced it and a real next step.
 * Campaign links appear only where the campaigns surface is offered and the viewer is the owner.
 */
export function buildInsights(input: { summary: RetentionSummary; unit: string; isOwner: boolean; campaigns: boolean; referrals: ReferralRow[] | null; winback?: WinbackState }): Insight[] {
  const { summary: s, unit, isOwner, campaigns, referrals, winback } = input;
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
    // Product (O8): drifting cards lead to the Wallet win-back where it is offered, never to an unreleased e-mail campaign.
    const returning = winback?.enabled ? `${cards(winback.inWindow)} ${winback.inWindow === 1 ? "bekommt den Willkommen-zurück-Bonus, wenn sie rechtzeitig wiederkommt." : "bekommen den Willkommen-zurück-Bonus, wenn sie rechtzeitig wiederkommen."}` : undefined;
    list.push({ id: "drifting", tone: "act", title: `${cards(s.drifting)} seit über ${days} Tagen ohne bestätigte Buchung`,
      why: `Diese Karten hatten schon bestätigte Buchungen, aber keine in den letzten ${days} Tagen. ${trend} Warum, wissen wir nicht.${returning ? ` ${returning}` : ""}`,
      next: returning,
      actions: [{ label: "Karten ansehen", href: retentionCustomerHref(s, "drifting") }, ...(winback && !winback.enabled ? [{ label: "Willkommen-zurück-Bonus einschalten", href: WINBACK_HREF }] : [])] });
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
