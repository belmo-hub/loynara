"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Archive, ArrowUpDown, BadgePlus, Bell, Cake, CalendarCheck, CalendarClock, Check, Clock, Coins, Gift, Hourglass, Medal, Megaphone, Nfc, Palette, Plus, ReceiptText, RefreshCw, ScrollText, Star, UserPlus, type LucideIcon } from "lucide-react";
import type { MeResponse, PublicProgram } from "@/components/client-api";
import { MixCard } from "@/components/customer/mix-card";
import { cx } from "@/components/ui/cx";
import { merchantPalette } from "@/components/ui/merchant-color";
import { MixChip, MixPanel, MixRow, MixSection, mixStyles } from "@/components/ui/mix";
import { EXCLUDED_GOODS } from "@/lib/card-extras";
import { useOwner } from "./owner-context";
import { ErrorNotice, LinkPending, LoadingBlock, nf, PageHead } from "./owner-ui";
import { cardDay } from "@/lib/change-lines";
import { ruleChips } from "./program-rule-changes";
import { euro, EXTRA_RULES, QUESTIONS, ruleKind, unitDative, unitName, type Question } from "./program-helpers";
import { ALL_MODES } from "./tap-policy";
import styles from "./program-list.module.css";
import { useLoad } from "./use-load";
import type { Winback } from "./winback-card";

type Row = { href: string; icon: LucideIcon; title: string; sub?: string; value?: string; big?: boolean; pair?: boolean; off?: boolean; /** ENG-100: a change waiting for its date (W29, W59). */ pending?: string };
/** `referrals` is the latest referrals read (empty when it failed); only those waiting for review count. */
export type ListData = { me: MeResponse; program: PublicProgram; winback: Winback | null; referrals: Array<{ status: string }>; nfc: boolean; logo: boolean; /** Rewards no longer live (owner read). */ archived?: number; /** Wallet messages offered: the birthday and reminder rows. */ messages?: boolean };

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

/** A reward row's chip while a change waits (W29, W59): the archive, a new cost (also with a new name), or a new name. */
export function rewardChip(type: PublicProgram["programType"], reward: PublicProgram["rewards"][number]) {
  if (reward.endsOn) return `Ab ${cardDay(reward.endsOn)} archiviert`;
  if (!reward.pending) return undefined;
  const day = cardDay(reward.pending.effectiveOn), cost = reward.pending.cost;
  return cost !== reward.cost ? `Ab ${day}: ${nf.format(cost)} ${unitName(type, cost)}` : `Ab ${day}: neuer Name`;
}

/** Every setting as one row with its current value (Design's list rules; copy W1–W32 FINAL). Text values are muted, numbers big. */
export function programSections({ me, program, winback, referrals, nfc, logo, archived = 0, messages = false }: ListData) {
  const type = program.programType, points = type === "points", referral = program.referral, rate = program.pointsPerCurrencyUnit;
  const reviews = referrals.filter(item => item.status === "review").length;
  const tap = ALL_MODES.find(mode => mode.id !== "disabled" && mode.id === me.tapMode);
  // By purchase amount the card states the earning itself, and the owner's text holds extra rules only (W51): the earning
  // row comes first, then what adds to it.
  const rules = program.ownerRulesText ?? program.rulesText, extras = ruleKind(type, program.earningMode) === "purchase";
  // ENG-100: rows keep the value in force; a change waiting for its date shows as a chip (Design gaps §1).
  const chips = ruleChips(program), expiry = program.pendingExpiry ? program.pendingExpiry.before : me.pointsExpiryMonths;
  // The whole rule, as the customer reads it; the row clamps it after two lines (Design, 18 Nov).
  const rule: Row = { ...ask("rule"), icon: ScrollText, pending: chips.rule, ...(extras ? { title: EXTRA_RULES, ...(rules ? { sub: quoteStart(rules, Infinity) } : off("Keine")) } : { sub: quoteStart(rules, Infinity) }) };
  const earning: Row[] = points ? [{ ...ask("earning"), icon: Coins, pending: chips.earning, sub: program.earningMode === "purchase" ? `Nach Einkaufswert: ${nf.format(rate)} ${unitName(type, rate)} pro ${program.currency === "EUR" ? "€" : program.currency}` : "Manuell" }] : [];
  const sections: Array<{ title: string; rows: Row[]; note?: string }> = [
    { title: "Prämien", rows: [
      ...program.rewards.map(reward => ({ href: `/merchant/program/rewards/${reward.rewardId}`, icon: Gift, title: reward.title, sub: `Einlösbar ab ${nf.format(reward.cost)} ${reward.cost === 1 ? unitName(type, 1) : unitDative(type)}`, pending: rewardChip(type, reward) })),
      ...(program.rewards.length > 1 ? [{ href: "/merchant/program/rewards/order", icon: ArrowUpDown, title: "Reihenfolge ändern" }] : []),
      { href: "/merchant/program/rewards/new", icon: Plus, title: "Prämie hinzufügen" },
      // Quiet, and only once a reward has been archived (Design): read-only, no restore.
      ...(archived ? [{ href: "/merchant/program/rewards/archived", icon: Archive, title: "Archivierte Prämien", ...off(nf.format(archived)) }] : []),
    ] },
    { title: "So sammeln Kunden", rows: [
      ...(extras ? [...earning, rule] : [rule, ...earning]),
      ...(points ? [{ ...ask("points-expiry"), icon: Hourglass, pending: chips.expiry, ...(expiry ? { sub: `Nach ${expiry} Monaten` } : off("Nie")) }] : []),
      ...(nfc ? [{ ...ask("nfc"), icon: Nfc, ...(tap ? { sub: tap.label } : off("Aus")) }] : []),
    ] },
    { title: "Extras", note: EXCLUDED_GOODS, rows: [
      { ...ask("welcome-bonus"), icon: BadgePlus, sub: "Mit der ersten Buchung, einmal pro Karte", ...(me.welcomeBonus ? big(`+${me.welcomeBonus}`) : off("Aus")) },
      { ...ask("winback"), icon: RefreshCw, ...(winback && { sub: `Nach ${winback.days} Tagen ohne Buchung`, ...(!winback.enabled ? off("Aus") : winback.bonus ? big(`+${winback.bonus}`) : off("Kein Bonus")) }) },
      // Moved here from Nachricht (Design, 6 Nov); both live on the Wallet-message surface.
      ...(messages ? [
        { ...ask("birthday"), icon: Cake, sub: "In der Geburtstagswoche", ...(me.birthdayEnabled ? { value: "An" } : off("Aus")) },
        { ...ask("almost"), icon: Bell, sub: "Wenn nur noch wenig fehlt", ...(winback?.almost ? { value: "An" } : off("Aus")) },
      ] : []),
      { ...ask("challenge"), icon: CalendarCheck, sub: "Bonus für viele Buchungen in einem Monat", ...(me.challengeVisits ? big(`+${me.challengeBonus ?? 1}`) : off("Aus")) },
      { ...ask("levels"), icon: Medal, sub: "Bronze, Silber, Gold nach Buchungstagen", ...(me.levelsEnabled ? { value: "An" } : off("Aus")) },
      // Referrals waiting for the owner's review replace the bonus with their count.
      { href: "/merchant/referrals", icon: UserPlus, title: "Empfehlungen", ...(reviews ? { sub: "Braucht deine Prüfung", ...big(nf.format(reviews)) } : { sub: "Bonus für die empfehlende und neue Karte",
        ...(!referral?.enabled ? off("Aus") : referral.referrerBonus === referral.referredBonus ? big(`+${referral.referrerBonus}`) : { ...big(`+${referral.referrerBonus} · +${referral.referredBonus}`), pair: true }) }) },
      ...(points ? [{ ...ask("happy-hour"), icon: Clock, ...(program.earningMode !== "purchase" ? { sub: "Nur bei Punkten nach Einkaufswert", ...off("Aus") } : me.happyHourEnabled ? { value: "An" } : off("Aus")) }] : []),
    ] },
    // The card studio holds the names (W38); where the logo upload is withheld (pilot surfaces) it offers the colour, no logo.
    // Mix A: its row leads the infos; „Aussehen“ is the card example above them.
    { title: "Infos auf der Karte", rows: [
      { href: "/merchant/program/card", icon: Palette, title: "Kundenkarte", sub: logo ? "Namen, Logo und Farbe" : "Namen und Farbe" },
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

// Where the owner left the list for a row's page, so the list comes back there (Design rule 10): row, scroll offset, saved,
// and the toast's words when a save did more than save („Neuigkeit entfernt“).
type Return = { row: string; y?: number; saved?: boolean; toast?: string };
const RETURN = "owner-programm-return";
/** Where each section stands in the mix layout (program-list.module.css). */
const AREA: Record<string, "rule" | "rew" | "ext" | "info" | "res"> = { "So sammeln Kunden": "rule", "Prämien": "rew", "Extras": "ext", "Infos auf der Karte": "info", "Für die Ergebnisse": "res" };
/** `list` names another list's return (Geschäft's sender rows, ENG-164); Programm's by default. */
export function readReturn(list = RETURN): Return | null {
  try { const value = JSON.parse(sessionStorage.getItem(list) ?? "null"); return typeof value?.row === "string" ? value : null; } catch { return null; }
}
export function writeReturn(value: Return | null, list = RETURN) {
  try { if (value) sessionStorage.setItem(list, JSON.stringify(value)); else sessionStorage.removeItem(list); } catch { /* storage may be unavailable */ }
}
/** A row's page saved: the list outlines `row` and says `toast`, scrolled as when the owner tapped `from`. */
export function markSaved(row: string, from = row, toast = "Gespeichert", list = RETURN) { const last = readReturn(list); writeReturn({ row, y: last?.row === from ? last.y : undefined, saved: true, toast }, list); }

/**
 * The example card under „Aussehen“, at five eighths of the first reward as the picture draws 5 of 8. A points card
 * draws every reward on its ladder (Design, ENG-292 §5); with two or more it names the second and has reached the first,
 * so a marker is pressed and the fill runs past it (Design, 20 Nov).
 */
export function exampleCard(type: PublicProgram["programType"], reward: { id: string; title: string; cost: number }, rewards?: Array<{ id: string; title: string; cost: number }>) {
  const [first, second] = [...(rewards ?? [])].sort((a, b) => a.cost - b.cost);
  if (type !== "points" || !second) return { reward, balance: Math.floor(reward.cost * 5 / 8) };
  return { reward: second, balance: Math.max(first.cost, Math.floor(second.cost * 5 / 8)) };
}

/**
 * It plays once per visit, when half of it is in view (Design, 20 Nov): the card arrives from .98, a points fill grows
 * from 0 and presses each marker it reached, earned stamps land 90 ms apart. Until then it waits unseen; reduced motion
 * shows the end state at once. Once played it settles, so a re-read replays nothing.
 * `place`: puts the page's scroll where it will stay (ProgramList's return), called before it measures whether half is in view.
 * In view then, it plays before the first paint; inside a fade that is still running (owner-shell's Skeleton to content)
 * the card only scales, and rides that fade rather than fading from nothing on top of it (Design, batch ef415313).
 */
export function ProgramExample({ me, type, reward, rewards, place }: { me: Pick<MeResponse, "businessName" | "locationName" | "brandColor">; type: PublicProgram["programType"]; reward: { id: string; title: string; cost: number }; rewards?: Array<{ id: string; title: string; cost: number }>; place?: () => void }) {
  const shown = exampleCard(type, reward, rewards);
  const ref = useRef<HTMLDivElement>(null);
  // Mounted only once the programme is read, so on the client: reduced motion starts at the end state.
  const [phase, setPhase] = useState<"wait" | "play" | "done">(() => typeof window === "undefined" || (typeof IntersectionObserver === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) ? "wait" : "done");
  const [ride, setRide] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || phase === "done") return;
    if (phase === "wait") {
      place?.();
      const box = el.getBoundingClientRect();
      const inView = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0);
      // Mounted in view: it is part of what the page shows first, so it arrives with the page's own fade.
      if (box.height > 0 && inView >= box.height / 2) { setRide(true); setPhase("play"); return; }
      const observer = new IntersectionObserver(([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        setRide(el.closest("[data-swap]")?.getAnimations().some(animation => animation.playState === "running") ?? false);
        setPhase("play");
      }, { threshold: 0.5 });
      observer.observe(el);
      return () => observer.disconnect();
    }
    el.querySelectorAll<HTMLElement>('[role="img"] > span[data-on]').forEach((stamp, i) => { stamp.setAttribute("data-new", ""); stamp.style.setProperty("--land-stagger", `${i * 90}ms`); });
    let live = true;
    const settle = () => { if (live) setPhase("done"); };
    void Promise.all((el.getAnimations?.({ subtree: true }) ?? []).map(animation => animation.finished)).then(settle, settle);
    return () => { live = false; };
  }, [phase, place]);
  return <div ref={ref} className={styles.example} data-play={phase} data-ride={ride || undefined} style={merchantPalette(me.brandColor ?? "", "light").cssVars as CSSProperties}>
    <MixCard size="example" businessName={me.businessName} locationName={me.locationName} programType={type === "points" ? "points" : "stamps"} balance={shown.balance} reward={{ id: shown.reward.id, title: shown.reward.title, cost: shown.reward.cost }} rewards={rewards}
      landedFrom={phase === "play" ? 0 : undefined} grow={phase === "play"} />
  </div>;
}

/** Programm for owners (ENG-099, Wegweiser): section labels on the grey, one link per setting with its current value. */
export function ProgramList({ me }: { me: MeResponse }) {
  const owner = useOwner();
  const slug = encodeURIComponent(me.programSlug);
  const [program, reload] = useLoad<PublicProgram>(`/api/program/${slug}`);
  const [winback] = useLoad<Winback>(`/api/merchant/program/winback?programSlug=${slug}`);
  const [referrals] = useLoad<{ referrals: Array<{ status: string }> }>(`/api/merchant/referrals?programSlug=${slug}`);
  const [stored] = useLoad<{ rewards: Array<{ active: boolean }> }>(`/api/merchant/program/rewards?programSlug=${slug}`);
  const [back] = useState(readReturn);
  const [toast, setToast] = useState(Boolean(back?.saved));
  // The two side reads only fill values; waiting for them keeps rows from moving once the list shows.
  const ready = program.state === "ok" && winback.state !== "loading" && referrals.state !== "loading" && stored.state !== "loading";
  useEffect(() => { writeReturn(null); }, []);
  // Before the first paint of the list: no frame of its top before the jump back, and the example measures itself where the
  // page will stay (a passive effect let it play off-screen on a return scrolled down). Once per visit; the example's
  // layout effect runs before this one, so it calls it first.
  const placed = useRef(false);
  const place = useCallback(() => {
    if (placed.current || !back) return;
    placed.current = true;
    if (typeof back.y === "number") window.scrollTo({ top: back.y, behavior: "instant" });
    // From the document: called from the example's layout effect, before the list's own ref is attached.
    const row = Array.from(document.querySelectorAll(".ow-content a")).find(link => link.getAttribute("href") === back.row);
    row?.scrollIntoView({ block: "nearest", behavior: "instant" });
    if (back.saved) row?.setAttribute("data-saved", "");
    (row as HTMLElement | undefined)?.focus({ preventScroll: true });
  }, [back]);
  useLayoutEffect(() => { if (ready) place(); }, [ready, place]);
  useEffect(() => {
    if (!ready || !toast) return;
    const timer = window.setTimeout(() => setToast(false), 4000);
    return () => window.clearTimeout(timer);
  }, [ready, toast]);

  const sections = program.state === "ok" && ready ? programSections({
    me, program: program.data, winback: winback.state === "ok" ? winback.data : null, nfc: !owner.hiddenSurfaces.includes("nfc"), logo: !owner.hiddenSurfaces.includes("cardLogo"), messages: !owner.hiddenSurfaces.includes("walletMessages"),
    referrals: referrals.state === "ok" ? referrals.data.referrals : [], archived: stored.state === "ok" ? stored.data.rewards.filter(reward => !reward.active).length : 0,
  }) : null;
  const section = (title: string) => {
    const found = sections?.find(item => item.title === title);
    return found && <div className={styles[AREA[title]]}><MixSection title={title} note={found.note}><MixPanel>{found.rows.map(({ icon: Icon, ...row }) =>
      <MixRow key={row.href} href={row.href} icon={<Icon size={20} />} sub={row.sub && row.href === "/merchant/program/rule" ? <span className={styles.clamp}>{row.sub}</span> : row.sub}
        title={<>{row.title}{row.pending && <span className="ow-chip ow-chip--warn"><CalendarClock size={16} aria-hidden="true" />{row.pending}</span>}<LinkPending /></>}
        end={row.value ? <span className={cx(mixStyles.val, !row.off && styles.on)}>{row.value}</span> : undefined} />)}</MixPanel></MixSection></div>;
  };
  const reward = program.state === "ok" ? program.data.rewards[0] : undefined;
  return (
    <div className="ow-page">
      <PageHead title="Programm" />
      {program.state === "error" ? <ErrorNotice message={program.message} onRetry={reload} /> : !sections ? <LoadingBlock rows={4} height={64} /> : (
        // One click handler for every row: the list comes back to the row it was left from.
        <div className={styles.split} data-bare={!reward || undefined} onClick={event => { const href = (event.target as Element).closest("a")?.getAttribute("href"); if (href) writeReturn({ row: href, y: window.scrollY }); }}>
          {reward && program.state === "ok" ? <>
            <div className={styles.col}>
              <div className={styles.look}><MixSection title="Aussehen" aside={<MixChip>Beispiel</MixChip>}><ProgramExample me={me} type={program.data.programType} reward={reward} rewards={program.data.rewards} place={place} /></MixSection></div>
              {section("So sammeln Kunden")}
              {section("Infos auf der Karte")}
            </div>
            <div className={styles.col}>
              {section("Prämien")}
              {section("Extras")}
              {section("Für die Ergebnisse")}
            </div>
          </> : <>
            {/* No reward yet: flat, „Prämie hinzufügen“ first, then the card group (Design, 18 Nov). */}
            {section("Prämien")}
            {section("So sammeln Kunden")}
            {section("Infos auf der Karte")}
            {section("Extras")}
            {section("Für die Ergebnisse")}
          </>}
        </div>
      )}
      <div className="ow-toast-region" role="status">{ready && toast && <span className="ow-toast"><Check size={20} aria-hidden="true" />{back?.toast ?? "Gespeichert"}</span>}</div>
    </div>
  );
}
