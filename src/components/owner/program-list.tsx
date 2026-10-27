"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, BadgePlus, CalendarCheck, Check, Clock, Gift, Hourglass, Medal, Megaphone, Nfc, Palette, Plus, ReceiptText, RefreshCw, ScrollText, Star, UserPlus, type LucideIcon } from "lucide-react";
import type { MeResponse, PublicProgram } from "@/components/client-api";
import { EXCLUDED_GOODS } from "@/lib/card-extras";
import { useOwner } from "./owner-context";
import { ErrorNotice, LoadingBlock, nf, PageHead } from "./owner-ui";
import { euro, QUESTIONS, unitDative, unitName, type Question } from "./program-helpers";
import { ALL_MODES } from "./tap-policy";
import { useLoad } from "./use-load";
import type { Winback } from "./winback-card";

type Row = { href: string; icon: LucideIcon; title: string; sub?: string; value?: string; big?: boolean; pair?: boolean; off?: boolean };
export type ListData = { me: MeResponse; program: PublicProgram; winback: Winback | null; reviews: number; nfc: boolean; logo: boolean };

const ask = (question: Question) => ({ href: `/merchant/program/${question}`, title: QUESTIONS[question] });
const off = (value: string) => ({ value, off: true });
const big = (value: string) => ({ value, big: true });
const host = (url: string) => { try { return new URL(url).host; } catch { return url; } };

/** The start of a text for a sub-line: whole words up to `max` characters, in quotes (W3). */
export function quoteStart(text: string, max = 44) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return `„${flat}“`;
  const cut = flat.lastIndexOf(" ", max);
  return `„${flat.slice(0, cut > 0 ? cut : max)} …“`;
}

/** Every setting as one row with its current value (Design's list rules; copy W1–W32 FINAL). Text values are muted, numbers big. */
export function programSections({ me, program, winback, reviews, nfc, logo }: ListData) {
  const type = program.programType, points = type === "points", referral = program.referral;
  const tap = ALL_MODES.find(mode => mode.id !== "disabled" && mode.id === me.tapMode);
  const sections: Array<{ title: string; rows: Row[]; note?: string }> = [
    { title: "Prämien", rows: [
      ...program.rewards.map(reward => ({ href: `/merchant/program/rewards/${reward.rewardId}`, icon: Gift, title: reward.title, sub: `Einlösbar ab ${nf.format(reward.cost)} ${reward.cost === 1 ? unitName(type, 1) : unitDative(type)}` })),
      { href: "/merchant/program/rewards/new", icon: Plus, title: "Prämie hinzufügen" },
    ] },
    { title: "So sammeln Kunden", rows: [
      { ...ask("rule"), icon: ScrollText, sub: quoteStart(program.ownerRulesText ?? program.rulesText) },
      ...(points ? [{ ...ask("points-expiry"), icon: Hourglass, ...(me.pointsExpiryMonths ? { sub: `Nach ${me.pointsExpiryMonths} Monaten` } : off("Nie")) }] : []),
      ...(nfc ? [{ ...ask("nfc"), icon: Nfc, ...(tap ? { sub: tap.label } : off("Aus")) }] : []),
    ] },
    { title: "Extras", note: EXCLUDED_GOODS, rows: [
      { ...ask("welcome-bonus"), icon: BadgePlus, sub: "Mit der ersten Buchung, einmal pro Karte", ...(me.welcomeBonus ? big(`+${me.welcomeBonus}`) : off("Aus")) },
      { ...ask("winback"), icon: RefreshCw, ...(winback && { sub: `Nach ${winback.days} Tagen ohne Buchung`, ...(!winback.enabled ? off("Aus") : winback.bonus ? big(`+${winback.bonus}`) : off("Kein Bonus")) }) },
      { ...ask("challenge"), icon: CalendarCheck, sub: "Bonus für viele Buchungen in einem Monat", ...(me.challengeVisits ? big(`+${me.challengeBonus ?? 1}`) : off("Aus")) },
      { ...ask("levels"), icon: Medal, sub: "Bronze, Silber, Gold nach Buchungstagen", ...(me.levelsEnabled ? { value: "An" } : off("Aus")) },
      // Referrals waiting for the owner's review replace the bonus with their count.
      { href: "/merchant/referrals", icon: UserPlus, title: "Empfehlungen", ...(reviews ? { sub: "Braucht deine Prüfung", ...big(nf.format(reviews)) } : { sub: "Bonus für die empfehlende und neue Karte",
        ...(!referral?.enabled ? off("Aus") : referral.referrerBonus === referral.referredBonus ? big(`+${referral.referrerBonus}`) : { ...big(`+${referral.referrerBonus} · +${referral.referredBonus}`), pair: true }) }) },
      ...(points ? [{ ...ask("happy-hour"), icon: Clock, ...(me.happyHourEnabled ? { value: "An" } : off("Aus")) }] : []),
    ] },
    // Where the logo upload is withheld (pilot surfaces), the card studio offers the colour only.
    { title: "Aussehen", rows: [{ href: "/merchant/program/card", icon: Palette, title: "Kundenkarte", sub: logo ? "Logo und Farbe" : "Farbe" }] },
    { title: "Infos auf der Karte", rows: [
      { ...ask("news"), icon: Megaphone, ...(me.cardNews ? { sub: quoteStart(me.cardNews) } : off("Keine")) },
      { ...ask("review-link"), icon: Star, ...(me.reviewUrl ? { sub: host(me.reviewUrl) } : off("Kein Link")) },
    ] },
  ];
  // Stamps and hand-entered points carry no amount, so only they ask for an average (as the extras card does).
  if (!points || program.earningMode === "manual") sections.push({ title: "Für die Ergebnisse", rows: [
    { ...ask("average-spend"), icon: ReceiptText, sub: "Nur für die Umsatzschätzung", ...(me.averageVisitSpendMinor ? { value: euro(me.averageVisitSpendMinor, program.currency) } : off("Kein Betrag")) },
  ] });
  return sections;
}

// Where the owner left the list for a row's page, so the list comes back there (Design rule 10): row, scroll offset, saved.
type Return = { row: string; y?: number; saved?: boolean };
const RETURN = "owner-programm-return";
function readReturn(): Return | null {
  try { const value = JSON.parse(sessionStorage.getItem(RETURN) ?? "null"); return typeof value?.row === "string" ? value : null; } catch { return null; }
}
function writeReturn(value: Return | null) {
  try { if (value) sessionStorage.setItem(RETURN, JSON.stringify(value)); else sessionStorage.removeItem(RETURN); } catch { /* storage may be unavailable */ }
}
/** A row's page saved: the list outlines that row and says „Gespeichert“. */
export function markSaved(row: string) { const last = readReturn(); writeReturn({ row, y: last?.row === row ? last.y : undefined, saved: true }); }

/** Programm for owners (ENG-099, Wegweiser): section labels on the grey, one link per setting with its current value. */
export function ProgramList({ me }: { me: MeResponse }) {
  const owner = useOwner();
  const slug = encodeURIComponent(me.programSlug);
  const [program, reload] = useLoad<PublicProgram>(`/api/program/${slug}`);
  const [winback] = useLoad<Winback>(`/api/merchant/program/winback?programSlug=${slug}`);
  const [referrals] = useLoad<{ referrals: Array<{ status: string }> }>(`/api/merchant/referrals?programSlug=${slug}`);
  const [back] = useState(readReturn);
  const [toast, setToast] = useState(Boolean(back?.saved));
  const list = useRef<HTMLDivElement>(null);
  // The two side reads only fill values; waiting for them keeps rows from moving once the list shows.
  const ready = program.state === "ok" && winback.state !== "loading" && referrals.state !== "loading";
  useEffect(() => { writeReturn(null); }, []);
  useEffect(() => {
    if (!ready || !back) return;
    if (typeof back.y === "number") window.scrollTo({ top: back.y, behavior: "instant" });
    const row = Array.from(list.current?.querySelectorAll("a") ?? []).find(link => link.getAttribute("href") === back.row);
    row?.scrollIntoView({ block: "nearest", behavior: "instant" });
    row?.focus({ preventScroll: true });
  }, [ready, back]);
  useEffect(() => {
    if (!ready || !toast) return;
    const timer = window.setTimeout(() => setToast(false), 4000);
    return () => window.clearTimeout(timer);
  }, [ready, toast]);

  const sections = program.state === "ok" && ready ? programSections({
    me, program: program.data, winback: winback.state === "ok" ? winback.data : null, nfc: !owner.hiddenSurfaces.includes("nfc"), logo: !owner.hiddenSurfaces.includes("cardLogo"),
    reviews: referrals.state === "ok" ? referrals.data.referrals.filter(item => item.status === "review").length : 0,
  }) : null;
  return (
    <div className="ow-page">
      <PageHead title="Programm" />
      {program.state === "error" ? <ErrorNotice message={program.message} onRetry={reload} /> : !sections ? <LoadingBlock rows={4} height={64} /> : (
        <div ref={list} className="ow-prog">
          {sections.map(section => <div key={section.title}>
            <h2>{section.title}</h2>
            <ul>{section.rows.map(({ icon: Icon, ...row }) => <li key={row.href}>
              <Link href={row.href} className="ow-prog-row" data-saved={(back?.saved && back.row === row.href) || undefined} onClick={() => writeReturn({ row: row.href, y: window.scrollY })}>
                <span className="ow-prog-icon"><Icon size={22} aria-hidden="true" /></span>
                <span className="ow-prog-main">
                  <span className="ow-prog-text"><strong>{row.title}</strong>{row.sub && <small>{row.sub}</small>}</span>
                  {row.value && <span className="ow-prog-value" data-big={row.big || undefined} data-pair={row.pair || undefined} data-off={row.off || undefined}>{row.value}</span>}
                </span>
                <ArrowRight className="ow-prog-arrow" size={22} aria-hidden="true" />
              </Link>
            </li>)}</ul>
            {section.note && <p className="ow-prog-note">{section.note}</p>}
          </div>)}
        </div>
      )}
      <div className="ow-toast-region" role="status">{ready && toast && <span className="ow-toast"><Check size={20} aria-hidden="true" />Gespeichert</span>}</div>
    </div>
  );
}
