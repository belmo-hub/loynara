"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLayoutEffect, useRef, useState, ViewTransition, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Activity as ActivityIcon, ArrowRight, ChevronDown, ChevronRight, Clock, Gift, RefreshCw, ScanLine, Search, Target, Users, type LucideIcon } from "lucide-react";
import { apiJson, type PublicProgram } from "@/components/client-api";
import { nearestReward, type CardReward } from "@/components/customer/card-face";
import { MixCard } from "@/components/customer/mix-card";
import { cx } from "@/components/ui/cx";
import { EmptyState } from "@/components/ui/empty-state";
import { merchantPalette } from "@/components/ui/merchant-color";
import { MixChip, mixStyles } from "@/components/ui/mix";
import { parseCardLocator } from "@/lib/card-locator";
import type { MerchantMember, MerchantMemberList } from "@/lib/merchant-members";
import type { RetentionSummary } from "@/lib/retention";
import { retentionCustomerHref } from "@/lib/retention-links";
import { germanDate } from "@/lib/german-date";
import { unitWord } from "@/lib/units";
import { bookingsText } from "@/lib/overview-day";
import { BROUGHT_COPY } from "@/lib/spend-copy";
import { CardScreen } from "./card-screen";
import { InviteRows } from "./join-card";
import { DemoDataChip, type Tile } from "./overview-board";
import { useOwner } from "./owner-context";
import { freshFade } from "./owner-shell";
import styles from "./customers-view.module.css";
import { ErrorNotice, LinkPending, LoadingBlock, nf, OwnerIcon } from "./owner-ui";
import { WINBACK_HREF } from "./retention-insights";
import { useLoad } from "./use-load";
import type { Winback } from "./winback-card";

type Activity = "all" | "recent" | "drifting" | "never" | "near_reward" | "reward_ready";
type Days = 14 | 30 | 60 | 90;
type Filters = { q: string; status: "all" | "active" | "closed"; activity: Activity; days: Days; minAgeDays: 0 | 7 };
const INITIAL: Filters = { q: "", status: "all", activity: "all", days: 30, minAgeDays: 0 };
const STATUS: Array<[Filters["status"], string]> = [["all", "Alle"], ["active", "Aktiv"], ["closed", "Geschlossen"]];
const ACTIVITY: Array<[Activity, string]> = [["all", "Alle Karten"], ["recent", "Kürzlich aktiv"], ["drifting", "Länger nicht da"], ["never", "Noch nie an der Kasse"], ["near_reward", "Kurz vor Prämie"], ["reward_ready", "Prämie verdient"]];
const DAYS: Days[] = [14, 30, 60, 90];
const groupName = (activity: Activity) => ACTIVITY.find(([value]) => value === activity)![1];

/** Why a card is in a group, in the same words the overview uses: the group's lead and the „?“ sheet on Kunden. */
function activityRule(activity: Activity, days: number, unit: string) {
  switch (activity) {
    case "recent": return `Mindestens eine bestätigte Buchung in den letzten ${days} Tagen.`;
    case "drifting": return `Früher bestätigte Buchungen, aber keine in den letzten ${days} Tagen. Warum, wissen wir nicht. Geschlossene Karten zählen nicht.`;
    case "never": return "Angemeldet, aber noch keine bestätigte Buchung. Nicht erfasste Besuche und die Gründe dafür sind unbekannt.";
    case "near_reward": return `Bis zur günstigsten aktiven Prämie fehlt höchstens ein Viertel, auf ganze Einheiten aufgerundet; bei 8 ${unit} also 1 bis 2.`;
    case "reward_ready": return "Der aktuelle Stand reicht für die günstigste aktive Prämie.";
    default: return "";
  }
}

/** Filters from the address bar, so overview insights can link straight to the matching cards. */
function filtersFromParams(params: URLSearchParams): Filters {
  const raw = params.get("activity");
  const activity = raw === "none" ? "never" : ACTIVITY.some(([value]) => value === raw) ? raw as Activity : "all";
  const days = Number(params.get("days"));
  const status = params.get("status");
  return { ...INITIAL, q: params.get("q") ?? "", status: status === "active" || status === "closed" ? status : "all", activity, days: DAYS.includes(days as Days) ? days as Days : 30, minAgeDays: activity === "never" && params.get("minAgeDays") === "7" ? 7 : 0 };
}

/** Changes the address in place; the page remounts on it (page.tsx), so links, Back and picks load the same way. */
function replaceParams(params: URLSearchParams, patch: Record<string, string | null>) {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(patch)) if (value === null) next.delete(key); else next.set(key, value);
  window.history.replaceState(null, "", `/merchant/customers?${next}`);
}

const reason = (cause: unknown) => cause instanceof Error ? cause.message : "Die Daten konnten nicht geladen werden.";

/** The CSV preview exists only on a local instance (its API answers 404 elsewhere), so the link is not offered anywhere else. */
function isLocalOrigin(url?: string) {
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url ?? "").hostname); } catch { return false; }
}

const GROUPS: Array<{ activity: Activity; icon: LucideIcon; count: (s: RetentionSummary) => number; sub?: (days: number) => string }> = [
  { activity: "all", icon: Users, count: s => s.openCards },
  { activity: "recent", icon: ActivityIcon, count: s => s.recent, sub: days => `Buchung in den letzten ${days} Tagen` },
  { activity: "drifting", icon: Clock, count: s => s.drifting, sub: days => `Seit ${days} Tagen keine Buchung mehr` },
  { activity: "never", icon: ScanLine, count: s => s.never, sub: () => "Angemeldet, noch keine Buchung" },
  { activity: "near_reward", icon: Target, count: s => s.nearReward, sub: () => "Höchstens ein Viertel bis zur Prämie" },
  { activity: "reward_ready", icon: Gift, count: s => s.rewardReady, sub: () => "Stand reicht für eine Prämie" },
];

/**
 * Kunden 01: the six groups with the read's counts (as on the Übersicht), R1's sub-lines with its days, the live rules
 * in the „?“ sheet. „Alle Karten“ counts the open cards, so it lists them; its screen can show the closed ones too.
 */
/** An owner's search covers every location (fault 18); the segment narrows it to one. A manager's scope is the server's. */
export const searchHref = (q: string, role: string) => q.trim() ? `/merchant/customers?${new URLSearchParams({ q: q.trim(), ...(role === "owner" ? { scope: "all" } : {}) })}` : "/merchant/customers";

export function groupTiles(s: RetentionSummary, unit: string): Tile[] {
  return GROUPS.map(({ activity, icon, count, sub }) => ({
    key: activity, icon, label: groupName(activity), value: nf.format(count(s)), note: sub?.(s.inactiveDays), help: activityRule(activity, s.inactiveDays, unit),
    href: activity === "all" ? `/merchant/customers?activity=all&status=active&${s.locationId ? `locationId=${s.locationId}` : "scope=all"}` : retentionCustomerHref(s, activity),
  }));
}

/**
 * The number beside a group's title: the read's total of what the list shows, whatever page the list has loaded
 * (Design, 18 Nov, #283). The read counts no closed cards, so „Alle“ and „Geschlossen“ show no number.
 */
export function groupCount(s: RetentionSummary, filters: Pick<Filters, "activity" | "status" | "minAgeDays">) {
  if (filters.activity === "all" && filters.status !== "active") return undefined;
  if (filters.minAgeDays === 7) return nf.format(s.neverAfterWeek);
  return nf.format(GROUPS.find(group => group.activity === filters.activity)!.count(s));
}

/** Where Back lands after a card: the list it was opened from and that list's scroll offset when the row was tapped. */
let listY: { list: string; y: number } | null = null;

/**
 * Kunden (ENG-122a, rest-build-map 01–06): the groups, one group's cards, one card. A card opens over its list (`card` in
 * the address); the list stays mounted under it, since the page keys on everything else, so Back finds it as it was.
 */
export function CustomersView() {
  const params = useSearchParams();
  const card = params.get("card");
  const list = new URLSearchParams(params);
  list.delete("card");
  const listKey = list.toString();
  const [fresh, setFresh] = useState<Record<string, MerchantMember>>({});
  const listBox = useRef<HTMLDivElement>(null), hadCard = useRef(false);
  // Opening and closing a card are screen changes of their own (freshFade); the path stays the same.
  const shownCard = useRef(card);
  useLayoutEffect(() => { if (card !== shownCard.current) freshFade(); shownCard.current = card; }, [card]);
  useLayoutEffect(() => {
    // Back from a card is a return, not an arrival: showing the list again restarts its entrances, so they end before
    // the paint. A loop (the placeholder's shimmer) has no end to jump to and is left alone.
    if (!card && hadCard.current) for (const animation of listBox.current?.getAnimations({ subtree: true }) ?? []) if (Number.isFinite(Number(animation.effect?.getComputedTiming().endTime))) animation.finish();
    hadCard.current = Boolean(card);
    if (card) { window.scrollTo({ top: 0, behavior: "instant" }); return; }
    if (listY?.list === listKey) window.scrollTo({ top: listY.y, behavior: "instant" });
    listY = null;
  }, [card, listKey]);
  // Opening a card and going back are screen changes (DESIGN.md, Motion), like every other row step: the card enters and
  // leaves, and the list under it, which stays mounted, is its own layer of that change (.ow-under, owner.css). A search
  // or a filter starts no change, so those stay in place with no fade. The card's box stays while its loading frame is
  // swapped for the card.
  return <>
    {card && <ViewTransition enter="ow-screen" exit="ow-screen" default="none"><div><CardScreen key={card} id={card} back={{ href: `/merchant/customers?${listKey}`, label: params.has("activity") ? groupName(filtersFromParams(params).activity) : "Kundenkarten" }}
      onMember={member => setFresh(current => current[member.id] === member ? current : { ...current, [member.id]: member })} /></div></ViewTransition>}
    <div ref={listBox} className="ow-under" hidden={Boolean(card)}><ListScreen fresh={fresh} /></div>
  </>;
}

/**
 * Kunden (the mix, A): the title with „CSV-Vorschau“, the search, then two panes from 1200: the groups with their counts
 * and „Kunden einladen“ beside the picked group's cards. Narrower, a group picker stands over the cards and the invite
 * follows them. No group in the address shows „Alle Karten“ (open cards, as its row links); a search lists its cards.
 */
function ListScreen({ fresh }: { fresh: Record<string, MerchantMember> }) {
  const me = useOwner().me!;
  const params = useSearchParams(), router = useRouter();
  const picked = params.has("activity");
  // A group's link may carry a search too (the Übersicht's): the group stays the screen, its list searched.
  const searched = picked ? "" : params.get("q")?.trim() ?? "";
  const [filters] = useState<Filters>(() => ({ ...filtersFromParams(params), ...!picked && !searched ? { status: "active" } : {} }));
  const [q, setQ] = useState(params.get("q")?.trim() ?? "");
  const allLocations = me.role === "owner" && params.get("scope") === "all";
  const scopeLocationId = params.get("locationId") || me.locationId;
  const here = !allLocations && scopeLocationId === me.locationId;
  const unit = me.programType === "points" ? "Punkten" : "Stempeln";
  const [summary, reload] = useLoad<RetentionSummary>(`/api/merchant/retention?days=${filters.days}${allLocations ? "" : `&locationId=${encodeURIComponent(scopeLocationId)}`}`);
  // The bonus is the active location's setting and the owner's to switch on (Product O8: drifting cards lead there).
  const [winback] = useLoad<Winback>(me.role === "owner" && here && filters.activity === "drifting" ? `/api/merchant/program/winback?programSlug=${encodeURIComponent(me.programSlug)}` : null);
  const short = q.trim().length > 0 && q.trim().length < 3 && parseCardLocator(q) === null;
  const tiles = summary.state === "ok" ? groupTiles(summary.data, unit) : [];
  const current = searched ? undefined : tiles.find(tile => tile.key === filters.activity);
  const count = searched || summary.state !== "ok" ? undefined : groupCount(summary.data, filters);
  const lead = searched ? "" : activityRule(filters.activity, filters.days, unit) + (filters.minAgeDays === 7 ? " Angezeigt werden nur Karten, die vor über sieben Tagen angelegt wurden." : "");
  function submit(event: FormEvent) {
    event.preventDefault();
    router.push(searchHref(q, me.role));
  }
  return (
    <div className={cx("ow-page", styles.page)}>
      <header className={styles.head}>
        <div className={cx("ow-pagehead", styles.title)}><h1>Kundenkarten</h1>
          {me.role === "owner" && isLocalOrigin(me.publicBaseUrl) && <Link className={cx(mixStyles.link, styles.link)} href="/merchant/customers/import">CSV-Vorschau</Link>}</div>
        <form className={cx("ow-search", styles.search)} role="search" onSubmit={submit} noValidate>
          <label htmlFor="cu-q" className="ow-sr">Kartennummer suchen</label>
          <Search size={20} aria-hidden="true" />
          <input id="cu-q" className="ow-input" type="search" enterKeyHint="search" value={q} onChange={event => setQ(event.target.value)} placeholder="Kartennummer suchen" autoComplete="off" aria-describedby={short ? "cu-q-hint" : undefined} />
          {short && <span id="cu-q-hint" className="ow-hint">Vollständige Kartennummer oder mindestens 3 Zeichen der internen ID.</span>}
        </form>
      </header>
      {/* Demo environment (pilot-surfaces „revenue“ is withheld only there): the groups below include the sample visits. */}
      {me.hiddenSurfaces?.includes("revenue") && <p><DemoDataChip /></p>}
      <div className={styles.split}>
        <div className={styles.side}>
          <section className={cx("ow-prog", styles.groups)} aria-labelledby="cu-groups">
            <h2 id="cu-groups">Gruppen</h2>
            {summary.state === "error" ? <ErrorNotice message={summary.message} onRetry={reload} />
              : summary.state !== "ok" ? <LoadingBlock rows={3} height={64} />
              : <ul>{tiles.map(tile => <li key={tile.key}><Link className="ow-prog-row" href={tile.href!} aria-current={tile === current || undefined}>
                <span className="ow-prog-icon"><tile.icon size={20} aria-hidden="true" /></span>
                <span className="ow-prog-main"><span className="ow-prog-text"><strong>{tile.label}</strong>{tile.note && <small>{tile.note}</small>}</span><span className="ow-prog-value">{tile.value}</span></span>
                <ChevronRight className="ow-prog-arrow" size={20} aria-hidden="true" />
                <LinkPending />
              </Link></li>)}</ul>}
          </section>
          <div className={cx("ow-prog", styles.invite)}>
            <InviteRows me={me} />
            <p className="ow-prog-note">Karten ohne Namen: Du siehst Kartennummer, Stand und jede bestätigte Buchung. Namen und Kontaktdaten zeigt Loynara nicht.</p>
          </div>
        </div>
        <div className={styles.main}>
          {!searched && tiles.length > 0 && <label className={styles.picker}>
            <span className="ow-sr">Gruppe</span>
            <select value={current?.key} onChange={event => router.push(tiles.find(tile => tile.key === event.target.value)!.href!)}>
              {tiles.map(tile => <option key={tile.key} value={tile.key}>{tile.label} {tile.value}</option>)}
            </select>
            <b aria-hidden="true">{current?.label}</b>{count && <span aria-hidden="true">{count}</span>}
            <ChevronDown size={20} aria-hidden="true" />
          </label>}
          {/* No card yet: the way to the first one is the invite (beside or under this). */}
          {!picked && !searched && summary.state === "ok" && summary.data.openCards === 0
            ? <EmptyState level={3} icon={<OwnerIcon name="users" size={24} />} title="Noch keine Karten.">Kunden melden sich über deinen Anmeldecode am Tresen an.</EmptyState>
            : <CardList filters={filters} fresh={fresh} title={searched ? undefined : groupName(filters.activity)} count={count} lead={lead} controls={<>
            {winback.state === "ok" && !winback.data.enabled && <Link className="ow-band" href={WINBACK_HREF}>
              <span className="ow-band-icon"><RefreshCw size={22} aria-hidden="true" /></span>
              <span className="ow-band-text"><b>{BROUGHT_COPY.bonusOff}</b><small>{BROUGHT_COPY.bonusOffText}</small></span>
              <ArrowRight className="ow-band-arrow" size={22} aria-hidden="true" />
              <LinkPending />
            </Link>}
            {(filters.activity === "recent" || filters.activity === "drifting") && <div className="ow-seg" role="group" aria-label="Zeitraum">
              {DAYS.map(days => <button key={days} type="button" aria-pressed={filters.days === days} onClick={() => replaceParams(params, { days: String(days) })}>{days} Tage</button>)}
            </div>}
            {!searched && filters.activity === "all" && <div className="ow-seg" role="group" aria-label="Kartenstatus">
              {STATUS.map(([value, label]) => <button key={value} type="button" aria-pressed={filters.status === value} onClick={() => replaceParams(params, { activity: "all", status: value === "all" ? null : value })}>{label}</button>)}
            </div>}
          </>} />}
        </div>
      </div>
    </div>
  );
}

/**
 * A card row's lead: the mix thumbnail counting to `target`, or the shop's colour alone where the card has no target here.
 * Points programmes keep today's row with no lead until Design draws a points card (Design, 18 Nov).
 */
export function cardLead(member: Pick<MerchantMember, "programType" | "balance">, target?: CardReward) {
  if (member.programType === "points") return null;
  return target ? <MixCard size="thumb" businessName="" locationName="" programType="stamps" balance={member.balance} reward={target} />
    : <span className={styles.blank} aria-hidden="true" />;
}

/** The cards of a group or a search, 25 at a time. A row opens its card over the list; `fresh` holds what a card screen read since. */
function CardList({ filters, fresh, title, count, lead, controls }: { filters: Filters; fresh: Record<string, MerchantMember>; title?: string; count?: string; lead?: string; controls?: ReactNode }) {
  const owner = useOwner();
  const me = owner.me!;
  const params = useSearchParams();
  const allLocations = me.role === "owner" && params.get("scope") === "all";
  const scopeLocationId = params.get("locationId") || me.locationId;
  const multi = me.role === "owner" && owner.locations.length > 1;
  const scopeName = owner.locations.find(location => location.id === scopeLocationId)?.name ?? me.locationName;
  const page = (cursor?: string) => {
    const query = new URLSearchParams({ status: filters.activity === "all" ? filters.status : "active", activity: filters.activity, days: String(filters.days) });
    if (filters.minAgeDays) query.set("minAgeDays", String(filters.minAgeDays));
    // The server validates and filters location IDs, so equal names and pagination cannot broaden this view.
    if (!allLocations) query.set("locationId", scopeLocationId);
    if (filters.q.trim()) query.set("q", filters.q.trim());
    if (cursor) query.set("cursor", cursor);
    return `/api/merchant/customers?${query}`;
  };
  const [first, reload] = useLoad<MerchantMemberList>(page());
  // The thumbnails count to the reward the card's own page names (card-screen), in the shop's colours.
  const [program] = useLoad<PublicProgram>(`/api/program/${encodeURIComponent(me.programSlug)}`);
  const rewards = program.state === "ok" ? program.data.rewards : [];
  const cheapest = rewards.length ? Math.min(...rewards.map(reward => reward.cost)) : Infinity;
  const palette = merchantPalette(program.state === "ok" ? program.data.brandColor ?? "" : "", "light").cssVars as CSSProperties;
  const [more, setMore] = useState<MerchantMemberList | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState("");
  const members = first.state === "ok" ? [...first.data.members, ...more?.members ?? []] : [];
  const next = more ? more.nextCursor : first.state === "ok" ? first.data.nextCursor : null;
  const list = new URLSearchParams(params);
  list.delete("card");

  async function loadMore() {
    if (!next || moreBusy) return;
    setMoreBusy(true); setMoreError("");
    try {
      const result = await apiJson<MerchantMemberList>(page(next));
      setMore(current => ({ members: [...current?.members ?? [], ...result.members], nextCursor: result.nextCursor }));
    } catch (cause) { setMoreError(reason(cause)); }
    finally { setMoreBusy(false); }
  }

  const n = members.length;
  const loaded = first.state === "ok" ? `${n}${next ? "+" : ""}` : undefined;
  return (
    <section className={cx("ow-prog", styles.cards)} aria-labelledby="cu-h" aria-busy={first.state === "loading"}>
      {title ? <div className={styles.named}><h2 id="cu-h">{title}</h2>{count && <span>{count}</span>}</div>
        : <h2 id="cu-h">{first.state === "ok" ? `${loaded} ${n === 1 && !next ? "Karte" : "Karten"}` : "Wird geladen …"}</h2>}
      {lead && <p className="ow-prog-note">{lead}</p>}
      {controls}
      {multi && <div className="ow-seg" role="group" aria-label="Umfang">
        <button type="button" aria-pressed={!allLocations} onClick={() => replaceParams(params, { scope: null, locationId: scopeLocationId })}>{scopeName}</button>
        <button type="button" aria-pressed={allLocations} onClick={() => replaceParams(params, { scope: "all", locationId: null })}>Alle Standorte</button>
      </div>}
      {first.state === "error" ? <ErrorNotice message={first.message} onRetry={reload} />
        : first.state !== "ok" ? <LoadingBlock rows={3} height={72} />
        : n === 0 ? <EmptyState level={3} title={filters.activity === "drifting" ? "Keine länger zurückliegende Kassenaktivität." : filters.activity === "reward_ready" ? "Keine offene Prämie." : "Keine Karten gefunden."}>
          {filters.activity === "drifting" ? `Für diese Auswahl gibt es keine Karte mit früheren bestätigten Buchungen und keiner in den letzten ${filters.days} Tagen.` : "Ändere oben die Auswahl, um weitere Karten zu sehen."}
        </EmptyState>
        : <ul style={palette} data-points={me.programType === "points" || undefined}>{members.map(listed => {
          const member = fresh[listed.id] ?? listed;
          const href = new URLSearchParams(list);
          href.set("card", member.id);
          // As on the card's page: the target is the active location's programme, so only its own open cards have one.
          const ours = !member.closedAt && member.locationId === me.locationId;
          const target = ours ? nearestReward(rewards, member.balance) : undefined;
          return <li key={member.id}><Link className="ow-prog-row" href={`/merchant/customers?${href}`} scroll={false} onClick={() => { listY = { list: list.toString(), y: window.scrollY }; }}>
            {cardLead(member, target)}
            <span className="ow-prog-main">
              <span className="ow-prog-text"><strong>{member.cardLocator}{member.closedAt ? <MixChip>Geschlossen</MixChip>
                : ours && member.balance >= cheapest && <MixChip warm><Gift size={16} aria-hidden="true" />Prämie verdient</MixChip>}</strong>
                <small>{member.lastQualifyingAt ? `Letzte Buchung ${germanDate(member.lastQualifyingAt, "feed")}` : "Noch nie an der Kasse"}{multi && allLocations ? ` · ${member.locationName}` : ""}</small></span>
              {member.programType === "points" ? <span className="ow-prog-value" data-pair="">{member.balance}<small> {unitWord(member.balance, "points")}</small></span>
                : <span className={cx("ow-prog-value", styles.bookings)} data-off="">{bookingsText(member.qualifyingCheckouts)}</span>}
            </span>
            <ChevronRight className="ow-prog-arrow" size={20} aria-hidden="true" />
            <LinkPending />
          </Link></li>;
        })}
          {next && <li><button type="button" className={styles.more} onClick={() => void loadMore()} disabled={moreBusy} aria-busy={moreBusy}>{moreBusy ? "Wird geladen …" : "Weitere Karten laden"}</button></li>}
        </ul>}
      {moreError && <ErrorNotice message={moreError} onRetry={() => void loadMore()} />}
    </section>
  );
}
