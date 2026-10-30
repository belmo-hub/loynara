"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLayoutEffect, useState, type FormEvent } from "react";
import { ArrowRight, Check, ChevronLeft, Gift, RefreshCw, Search, Users, X, type LucideIcon } from "lucide-react";
import { apiJson } from "@/components/client-api";
import { EmptyState } from "@/components/ui/empty-state";
import { parseCardLocator } from "@/lib/card-locator";
import type { MerchantMember, MerchantMemberList } from "@/lib/merchant-members";
import type { RetentionSummary } from "@/lib/retention";
import { retentionCustomerHref } from "@/lib/retention-links";
import { BROUGHT_COPY } from "@/lib/spend-copy";
import { unitWord } from "@/lib/units";
import { CardScreen } from "./card-screen";
import { InviteRows } from "./join-card";
import { Tiles, type Tile } from "./overview-board";
import { useOwner } from "./owner-context";
import { ErrorNotice, LoadingBlock, nf, OwnerIcon, PageHead } from "./owner-ui";
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

function sinceLast(value: string | null) {
  if (!value) return "Noch nie an der Kasse";
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  return days <= 0 ? "Zuletzt heute" : days === 1 ? "Zuletzt gestern" : `Zuletzt vor ${days} Tagen`;
}

const reason = (cause: unknown) => cause instanceof Error ? cause.message : "Die Daten konnten nicht geladen werden.";

/** The CSV preview exists only on a local instance (its API answers 404 elsewhere), so the link is not offered anywhere else. */
function isLocalOrigin(url?: string) {
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url ?? "").hostname); } catch { return false; }
}

const GROUPS: Array<{ activity: Activity; icon: LucideIcon; count: (s: RetentionSummary) => number; sub?: (days: number) => string }> = [
  { activity: "all", icon: Users, count: s => s.openCards },
  { activity: "recent", icon: Check, count: s => s.recent, sub: days => `Buchung in den letzten ${days} Tagen` },
  { activity: "drifting", icon: RefreshCw, count: s => s.drifting, sub: days => `Seit ${days} Tagen keine Buchung mehr` },
  { activity: "never", icon: X, count: s => s.never, sub: () => "Angemeldet, noch keine Buchung" },
  { activity: "near_reward", icon: Gift, count: s => s.nearReward, sub: () => "Höchstens ein Viertel bis zur Prämie" },
  { activity: "reward_ready", icon: Gift, count: s => s.rewardReady, sub: () => "Stand reicht für eine Prämie" },
];

/**
 * Kunden 01: the six groups with the read's counts (as on the Übersicht), R1's sub-lines with its days, the live rules
 * in the „?“ sheet. „Alle Karten“ counts the open cards, so it lists them; its screen can show the closed ones too.
 */
export function groupTiles(s: RetentionSummary, unit: string): Tile[] {
  return GROUPS.map(({ activity, icon, count, sub }) => ({
    key: activity, icon, label: groupName(activity), value: nf.format(count(s)), note: sub?.(s.inactiveDays), help: activityRule(activity, s.inactiveDays, unit),
    href: activity === "all" ? `/merchant/customers?activity=all&status=active&${s.locationId ? `locationId=${s.locationId}` : "scope=all"}` : retentionCustomerHref(s, activity),
  }));
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
  useLayoutEffect(() => {
    if (card) { window.scrollTo({ top: 0, behavior: "instant" }); return; }
    if (listY?.list === listKey) window.scrollTo({ top: listY.y, behavior: "instant" });
    listY = null;
  }, [card, listKey]);
  return <>
    {card && <CardScreen key={card} id={card} back={{ href: `/merchant/customers?${listKey}`, label: params.has("activity") ? groupName(filtersFromParams(params).activity) : "Kundenkarten" }}
      onMember={member => setFresh(current => current[member.id] === member ? current : { ...current, [member.id]: member })} />}
    <div hidden={Boolean(card)}>{params.has("activity") ? <GroupScreen fresh={fresh} /> : <GroupsScreen fresh={fresh} />}</div>
  </>;
}

/** 01: the search on top, the groups, then „Kunden einladen“ (moved here from the Übersicht). A search lists its cards instead. */
function GroupsScreen({ fresh }: { fresh: Record<string, MerchantMember> }) {
  const me = useOwner().me!;
  const params = useSearchParams(), router = useRouter();
  const searched = params.get("q")?.trim() ?? "";
  const [q, setQ] = useState(searched);
  const [summary, reload] = useLoad<RetentionSummary>(searched ? null : `/api/merchant/retention?days=30&locationId=${encodeURIComponent(me.locationId)}`);
  const short = q.trim().length > 0 && q.trim().length < 3 && parseCardLocator(q) === null;
  function submit(event: FormEvent) {
    event.preventDefault();
    router.push(q.trim() ? `/merchant/customers?${new URLSearchParams({ q: q.trim() })}` : "/merchant/customers");
  }
  return (
    <div className="ow-page">
      <PageHead title="Kundenkarten" actions={me.role === "owner" && isLocalOrigin(me.publicBaseUrl) ? <Link className="ow-btn ow-btn--ghost" href="/merchant/customers/import">CSV-Vorschau</Link> : undefined} />
      <form className="ow-search" role="search" onSubmit={submit}>
        <label htmlFor="cu-q" className="ow-sr">Kartennummer suchen</label>
        <Search size={20} aria-hidden="true" />
        <input id="cu-q" className="ow-input" type="search" enterKeyHint="search" value={q} onChange={event => setQ(event.target.value)} placeholder="Kartennummer suchen" autoComplete="off" aria-describedby={short ? "cu-q-hint" : undefined} />
        {short && <span id="cu-q-hint" className="ow-hint">Vollständige Kartennummer oder mindestens 3 Zeichen der internen ID.</span>}
      </form>
      {searched ? <CardList filters={filtersFromParams(params)} fresh={fresh} /> : <div className="ow-prog">
        {summary.state === "error" ? <ErrorNotice message={summary.message} onRetry={reload} />
          : summary.state !== "ok" ? <LoadingBlock rows={3} height={64} />
          // No card yet: the way to the first one is the invite right below (the old line pointed to the Übersicht).
          : summary.data.openCards === 0 ? <EmptyState level={3} icon={<OwnerIcon name="users" size={24} />} title="Noch keine Karten.">Kunden melden sich über deinen Anmeldecode am Tresen an.</EmptyState>
          : <Tiles title="Gruppen" tiles={groupTiles(summary.data, me.programType === "points" ? "Punkten" : "Stempeln")} />}
        <InviteRows me={me} />
        <p className="ow-prog-note">Karten ohne Namen: Du siehst Kartennummer, Stand und jede bestätigte Buchung. Namen und Kontaktdaten zeigt Loynara nicht.</p>
      </div>}
    </div>
  );
}

/** 02: one group. Its live rule as the lead, its next step as the band, the day (or card status) choice, its cards. */
function GroupScreen({ fresh }: { fresh: Record<string, MerchantMember> }) {
  const me = useOwner().me!;
  const params = useSearchParams();
  const [filters] = useState(() => filtersFromParams(params));
  const here = !(me.role === "owner" && params.get("scope") === "all") && (params.get("locationId") || me.locationId) === me.locationId;
  // The bonus is the active location's setting and the owner's to switch on (Product O8: drifting cards lead there).
  const [winback] = useLoad<Winback>(me.role === "owner" && here && filters.activity === "drifting" ? `/api/merchant/program/winback?programSlug=${encodeURIComponent(me.programSlug)}` : null);
  const lead = activityRule(filters.activity, filters.days, me.programType === "points" ? "Punkten" : "Stempeln") + (filters.minAgeDays === 7 ? " Angezeigt werden nur Karten, die vor über sieben Tagen angelegt wurden." : "");
  return (
    <div className="ow-page">
      <header className="ow-pagehead"><div className="ow-qhead">
        <Link href="/merchant/customers" className="ow-back"><ChevronLeft size={20} aria-hidden="true" />Kundenkarten</Link>
        <h1>{groupName(filters.activity)}</h1>
        {lead && <p>{lead}</p>}
      </div></header>
      {winback.state === "ok" && !winback.data.enabled && <Link className="ow-band" href={WINBACK_HREF}>
        <span className="ow-band-icon"><RefreshCw size={22} aria-hidden="true" /></span>
        <span className="ow-band-text"><b>{BROUGHT_COPY.bonusOff}</b><small>{BROUGHT_COPY.bonusOffText}</small></span>
        <ArrowRight className="ow-band-arrow" size={22} aria-hidden="true" />
      </Link>}
      {(filters.activity === "recent" || filters.activity === "drifting") && <div className="ow-seg" role="group" aria-label="Zeitraum">
        {DAYS.map(days => <button key={days} type="button" aria-pressed={filters.days === days} onClick={() => replaceParams(params, { days: String(days) })}>{days} Tage</button>)}
      </div>}
      {filters.activity === "all" && <div className="ow-seg" role="group" aria-label="Kartenstatus">
        {STATUS.map(([value, label]) => <button key={value} type="button" aria-pressed={filters.status === value} onClick={() => replaceParams(params, { status: value === "all" ? null : value })}>{label}</button>)}
      </div>}
      <CardList filters={filters} fresh={fresh} />
    </div>
  );
}

/** The cards of a group or a search, 25 at a time. A row opens its card over the list; `fresh` holds what a card screen read since. */
function CardList({ filters, fresh }: { filters: Filters; fresh: Record<string, MerchantMember> }) {
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
  return (
    <section className="ow-prog" aria-labelledby="cu-h" aria-busy={first.state === "loading"}>
      {multi && <div className="ow-seg" role="group" aria-label="Umfang">
        <button type="button" aria-pressed={!allLocations} onClick={() => replaceParams(params, { scope: null, locationId: scopeLocationId })}>{scopeName}</button>
        <button type="button" aria-pressed={allLocations} onClick={() => replaceParams(params, { scope: "all", locationId: null })}>Alle Standorte</button>
      </div>}
      <h2 id="cu-h">{first.state === "ok" ? `${n}${next ? "+" : ""} ${n === 1 && !next ? "Karte" : "Karten"}${multi && !allLocations ? ` am Standort ${scopeName}` : ""}` : "Wird geladen …"}</h2>
      {first.state === "error" ? <ErrorNotice message={first.message} onRetry={reload} />
        : first.state !== "ok" ? <LoadingBlock rows={3} height={64} />
        : n === 0 ? <EmptyState level={3} title={filters.activity === "drifting" ? "Keine länger zurückliegende Kassenaktivität." : filters.activity === "reward_ready" ? "Keine offene Prämie." : "Keine Karten gefunden."}>
          {filters.activity === "drifting" ? `Für diese Auswahl gibt es keine Karte mit früheren bestätigten Buchungen und keiner in den letzten ${filters.days} Tagen.` : "Ändere oben die Auswahl, um weitere Karten zu sehen."}
        </EmptyState>
        : <ul>{members.map(listed => {
          const member = fresh[listed.id] ?? listed;
          const href = new URLSearchParams(list);
          href.set("card", member.id);
          return <li key={member.id}><Link className="ow-prog-row" href={`/merchant/customers?${href}`} scroll={false} onClick={() => { listY = { list: list.toString(), y: window.scrollY }; }}>
            <span className="ow-prog-icon"><Users size={22} aria-hidden="true" /></span>
            <span className="ow-prog-main">
              <span className="ow-prog-text"><strong>{member.cardLocator}</strong>{member.closedAt ? <span className="ow-chip">Geschlossen</span>
                : <small>{sinceLast(member.lastQualifyingAt)}{multi && allLocations ? ` · ${member.locationName}` : ""}</small>}</span>
              <span className="ow-prog-value" data-pair="">{member.balance}<small> {unitWord(member.balance, member.programType)}</small></span>
            </span>
            <ArrowRight className="ow-prog-arrow" size={22} aria-hidden="true" />
          </Link></li>;
        })}</ul>}
      {moreError && <ErrorNotice message={moreError} onRetry={() => void loadMore()} />}
      {next && <div className="ow-mt-3"><button type="button" className="ow-btn ow-btn--secondary" onClick={() => void loadMore()} disabled={moreBusy} aria-busy={moreBusy}>{moreBusy ? "Wird geladen …" : "Weitere Karten laden"}</button></div>}
    </section>
  );
}
