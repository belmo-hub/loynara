"use client";

import type { RetentionSummary } from "@/lib/retention";
import { retentionCustomerHref } from "@/lib/retention-links";
import { nf } from "./owner-ui";

export type ReferralRow = { status: string };
/** `next`: an extra sentence for "Als Nächstes" on the Übersicht. */
export type Insight = { id: string; tone: "act" | "watch"; title: string; next?: string; actions: Array<{ label: string; href: string }> };
/** The win-back bonus as the per-location read returns it (`enabled`: on with a bonus); null where the location has no programme. */
export type WinbackState = { enabled: boolean; inWindow: number } | null;
/** The win-back setting: on Programm since ENG-089 (Wallet-Nachrichten no longer has it). */
export const WINBACK_HREF = "/merchant/program/winback";

const cards = (n: number) => `${nf.format(n)} ${n === 1 ? "Karte" : "Karten"}`;

/**
 * Deterministic observations from recorded data, each with the rule that produced it and a real next step.
 * Campaign links appear only where the campaigns surface is offered and the viewer is the owner.
 */
export function buildInsights(input: { summary: RetentionSummary; isOwner: boolean; campaigns: boolean; referrals: ReferralRow[] | null; winback?: WinbackState }): Insight[] {
  const { summary: s, isOwner, campaigns, referrals, winback } = input;
  const days = s.inactiveDays;
  const draft = isOwner && campaigns && s.programCount === 1;
  const list: Insight[] = [];
  const review = referrals?.filter(row => row.status === "review").length ?? 0;
  if (review > 0) list.push({ id: "referral-review", tone: "act", title: `${nf.format(review)} ${review === 1 ? "Empfehlung braucht" : "Empfehlungen brauchen"} deine Prüfung`,
    actions: [{ label: "Empfehlungen prüfen", href: "/merchant/referrals" }] });
  if (s.rewardReady > 0) list.push({ id: "reward-ready", tone: "act", title: `${cards(s.rewardReady)} ${s.rewardReady === 1 ? "kann" : "können"} jetzt eine Prämie einlösen`,
    actions: [{ label: "Karten ansehen", href: retentionCustomerHref(s, "reward_ready") }] });
  if (s.drifting > 0) {
    // Product (O8): drifting cards lead to the Wallet win-back where it is offered, never to an unreleased e-mail campaign.
    const returning = winback?.enabled && winback.inWindow > 0 ? `${cards(winback.inWindow)} ${winback.inWindow === 1 ? "bekommt den Willkommen-zurück-Bonus, wenn sie rechtzeitig wiederkommt." : "bekommen den Willkommen-zurück-Bonus, wenn sie rechtzeitig wiederkommen."}` : undefined;
    list.push({ id: "drifting", tone: "act", title: `${cards(s.drifting)} seit über ${days} Tagen ohne bestätigte Buchung`,
      next: returning,
      actions: [{ label: "Karten ansehen", href: retentionCustomerHref(s, "drifting") }, ...(isOwner && winback && !winback.enabled ? [{ label: "Willkommen-zurück-Bonus einschalten", href: WINBACK_HREF }] : [])] });
  }
  if (s.nearReward > 0) {
    const gap = s.nearRewardMaxRemaining;
    list.push({ id: "near-reward", tone: "watch", title: `${cards(s.nearReward)} ${s.nearReward === 1 ? "ist" : "sind"} kurz vor einer Prämie`,
      actions: [{ label: "Karten ansehen", href: retentionCustomerHref(s, "near_reward") }, ...(draft && gap && s.nearRewardId ? [{ label: "Erinnerung vorbereiten", href: `/merchant/campaigns?goal=near-reward&maxRemaining=${gap}&rewardId=${encodeURIComponent(s.nearRewardId!)}` }] : [])] });
  }
  if (s.neverAfterWeek > 0) list.push({ id: "never", tone: "watch", title: `${cards(s.neverAfterWeek)} seit über einer Woche angemeldet, aber nie an der Kasse bestätigt`,
    actions: [{ label: "Karten ansehen", href: retentionCustomerHref(s, "never", 7) }] });
  const waiting = referrals?.filter(row => row.status === "pending").length ?? 0;
  if (waiting > 0) list.push({ id: "referral-waiting", tone: "watch", title: `${nf.format(waiting)} ${waiting === 1 ? "geworbene Karte wartet" : "geworbene Karten warten"} auf die erste bestätigte Buchung`,
    actions: [{ label: "Empfehlungen ansehen", href: "/merchant/referrals" }] });
  return list;
}
