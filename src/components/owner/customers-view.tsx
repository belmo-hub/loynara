"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { apiJson } from "@/components/client-api";
import { parseCardLocator } from "@/lib/card-locator";
import type { MerchantMember, MerchantMemberDetail, MerchantMemberList } from "@/lib/merchant-members";
import { useOwner } from "./owner-context";
import { CorrectionDialog, correctable, ReissueDialog, sourceLabel } from "./card-actions";
import { germanDate, Notice, Skeleton, OwnerIcon } from "./owner-ui";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClassName } from "@/components/ui/button";

type Activity = "all" | "recent" | "drifting" | "never" | "near_reward" | "reward_ready";
type Days = 14 | 30 | 60 | 90;
type Filters = { q: string; status: "all" | "active" | "closed"; activity: Activity; days: Days; minAgeDays: 0 | 7 };
const INITIAL: Filters = { q: "", status: "all", activity: "all", days: 30, minAgeDays: 0 };
const unfiltered = (filters: Filters) => !filters.q && filters.status === "all" && filters.activity === "all" && filters.minAgeDays === 0;
const STATUS: Array<[Filters["status"], string]> = [["all", "Alle"], ["active", "Aktiv"], ["closed", "Geschlossen"]];
const ACTIVITY: Array<[Activity, string]> = [["all", "Alle Karten"], ["recent", "Kürzlich aktiv"], ["drifting", "Länger nicht da"], ["never", "Noch nie an der Kasse"], ["near_reward", "Kurz vor Prämie"], ["reward_ready", "Prämie verdient"]];
const DAYS: Days[] = [14, 30, 60, 90];

/** Why a card is in the chosen view, in the same words the overview uses. */
function activityRule(activity: Activity, days: Days, unit: string) {
  switch (activity) {
    case "recent": return `Mindestens ein bestätigter Kassenvorgang in den letzten ${days} Tagen.`;
    case "drifting": return `Früher bestätigte Kassenvorgänge, aber keiner in den letzten ${days} Tagen. Warum, wissen wir nicht. Geschlossene Karten zählen nicht.`;
    case "never": return "Angemeldet, aber noch kein bestätigter Kassenvorgang. Nicht erfasste Besuche und die Gründe dafür sind unbekannt.";
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

function sinceLast(value: string | null) {
  if (!value) return "Noch nie an der Kasse";
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  return days <= 0 ? "Zuletzt heute" : days === 1 ? "Zuletzt gestern" : `Zuletzt vor ${days} Tagen`;
}

const unitOf = (m: Pick<MerchantMember, "programType">) => m.programType === "stamp" ? "Stempel" : "Punkte";
const when = (value: string | null) => value ? germanDate(value, true) : "Noch kein bestätigter Vorgang";
const reason = (cause: unknown) => cause instanceof Error ? cause.message : "Die Daten konnten nicht geladen werden.";

function eligibilityLabel(value: MerchantMember["eligibility"]) {
  return ({ eligible: "Prämie einlösbar", not_yet: "Noch nicht einlösbar", not_configured: "Keine aktive Prämie", closed: "Karte geschlossen", not_checked: "Noch nicht geprüft", unavailable: "Nicht verfügbar" } as const)[value];
}
function referralLabel(value: MerchantMember["referralStatus"]) {
  return ({ none: "Keine Zuordnung", pending: "Wartet auf den ersten bestätigten Vorgang", qualified: "Bonus gutgeschrieben", review: "In Prüfung", rejected: "Abgelehnt", reversed: "Nach Korrektur zurückgenommen" } as const)[value];
}

/** The CSV preview exists only on a local instance (its API answers 404 elsewhere), so the link is not offered anywhere else. */
function isLocalOrigin(url?: string) {
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url ?? "").hostname); } catch { return false; }
}

export function CustomersView() {
  const owner = useOwner();
  const me = owner.me!;
  // useSearchParams, not window.location: a client-side navigation from the overview has not updated the URL at first render.
  const searchParams = useSearchParams();
  const [start] = useState(() => filtersFromParams(searchParams));
  const [filters, setFilters] = useState<Filters>(start);
  const [applied, setApplied] = useState<Filters>(start);
  const [allLocations] = useState(me.role === "owner" && searchParams.get("scope") === "all");
  const [scopeLocationId] = useState(() => searchParams.get("locationId") || me.locationId);
  const [members, setMembers] = useState<MerchantMember[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<MerchantMemberDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [olderBusy, setOlderBusy] = useState(false);
  const [correcting, setCorrecting] = useState<MerchantMemberDetail["timeline"][number] | null>(null);
  const [reissuing, setReissuing] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  const token = useRef(0);
  const detailToken = useRef(0);

  const multi = me.role === "owner" && owner.locations.length > 1;
  const narrow = !allLocations;
  const narrowId = narrow ? scopeLocationId : null;
  const scopeName = owner.locations.find(location => location.id === scopeLocationId)?.name ?? me.locationName;
  // The server validates and filters location IDs, so equal names and pagination cannot broaden this view.
  const visible = members;
  const fetchPage = useCallback((chosen: Filters, cursor?: string, locationId?: string | null) => {
    const params = new URLSearchParams({ status: chosen.activity === "all" ? chosen.status : "active", activity: chosen.activity, days: String(chosen.days) });
    if (chosen.minAgeDays) params.set("minAgeDays", String(chosen.minAgeDays));
    if (locationId) params.set("locationId", locationId);
    if (chosen.q.trim()) params.set("q", chosen.q.trim());
    if (cursor) params.set("cursor", cursor);
    return apiJson<MerchantMemberList>(`/api/merchant/customers?${params}`);
  }, []);
  const fetchVisible = useCallback(async (chosen: Filters, cursor: string | undefined, locationId: string | null) => {
    const page = await fetchPage(chosen, cursor, locationId);
    return { members: page.members, next: page.nextCursor };
  }, [fetchPage]);
  const initialScope = useRef(narrowId);

  const run = useCallback(async (chosen: Filters, override?: string | null) => {
    const mine = ++token.current;
    setLoading(true); setError(""); setSelected(null); setDetail(null); detailToken.current++;
    try {
      const page = await fetchVisible(chosen, undefined, override === undefined ? narrowId : override);
      if (token.current !== mine) return;
      setMembers(page.members); setNext(page.next); setApplied(chosen);
    } catch (cause) { if (token.current === mine) setError(reason(cause)); }
    finally { if (token.current === mine) setLoading(false); }
  }, [fetchVisible, narrowId]);

  useEffect(() => {
    let live = true;
    const mine = ++token.current;
    void fetchVisible(start, undefined, initialScope.current).then(page => { if (live && token.current === mine) { setMembers(page.members); setNext(page.next); setLoading(false); } })
      .catch(cause => { if (live && token.current === mine) { setError(reason(cause)); setLoading(false); } });
    return () => { live = false; };
  }, [fetchVisible, start]);

  async function loadMore() {
    if (!next || more) return;
    setMore(true); setError("");
    const mine = token.current;
    try {
      const page = await fetchVisible(applied, next, narrowId);
      if (token.current !== mine) return;
      setMembers(current => [...current, ...page.members]); setNext(page.next);
    } catch (cause) { setError(reason(cause)); }
    finally { setMore(false); }
  }

  function updateAddress(chosen: Filters, all = allLocations) {
    const params = new URLSearchParams();
    if (chosen.q.trim()) params.set("q", chosen.q.trim());
    if (chosen.status !== "all") params.set("status", chosen.status);
    if (chosen.activity !== "all") params.set("activity", chosen.activity);
    if (chosen.activity === "recent" || chosen.activity === "drifting") params.set("days", String(chosen.days));
    if (chosen.minAgeDays) params.set("minAgeDays", String(chosen.minAgeDays));
    if (all) params.set("scope", "all"); else params.set("locationId", scopeLocationId);
    // The page remounts for URL changes, so direct links, browser traversal and local picks use the same load.
    window.history.replaceState(null, "", `/merchant/customers${params.size ? `?${params}` : ""}`);
  }
  function submit(event: FormEvent) { event.preventDefault(); updateAddress(filters); }
  function pick(patch: Partial<Filters>) {
    const chosen = { ...filters, ...patch, minAgeDays: patch.activity ? 0 as const : filters.minAgeDays };
    setFilters(chosen); updateAddress(chosen);
  }

  async function open(id: string, keepNotice = false) {
    const mine = ++detailToken.current;
    setSelected(id); setDetail(null); setDetailError(""); setDetailBusy(true);
    if (!keepNotice) setActionNotice("");
    try {
      const result = await apiJson<MerchantMemberDetail>(`/api/merchant/customers/${encodeURIComponent(id)}`);
      if (detailToken.current === mine) {
        setDetail(result);
        // Keep the list row in step with the detail after a correction or reissue.
        setMembers(current => current.map(member => member.id === result.member.id ? result.member : member));
      }
    } catch (cause) { if (detailToken.current === mine) setDetailError(reason(cause)); }
    finally { if (detailToken.current === mine) setDetailBusy(false); }
  }
  async function older() {
    if (!selected || !detail?.nextCursor || olderBusy) return;
    const mine = detailToken.current; setOlderBusy(true); setDetailError("");
    try {
      const page = await apiJson<MerchantMemberDetail>(`/api/merchant/customers/${encodeURIComponent(selected)}?cursor=${encodeURIComponent(detail.nextCursor)}`);
      if (detailToken.current === mine) setDetail(current => current && ({ ...page, timeline: [...current.timeline, ...page.timeline] }));
    } catch (cause) { setDetailError(reason(cause)); }
    finally { setOlderBusy(false); }
  }

  // Corrections and reissues run against the active location (the server checks the same); elsewhere only explain.
  const canAct = !!detail && detail.member.locationId === me.locationId && !detail.member.closedAt;
  const searchShort = filters.q.trim().length > 0 && filters.q.trim().length < 3 && parseCardLocator(filters.q) === null;
  return (
    <div className="ow-page">
      <header className="ow-pagehead">
        <div><p className="ow-eyebrow">Kunden</p><h1>Kundenkarten</h1><p>Karten ohne Namen: Du siehst Kartennummer, Stand und jede bestätigte Buchung. Namen und Kontaktdaten zeigt Loynara nicht.</p></div>
        <div className="ow-row">{!(me.hiddenSurfaces ?? []).includes("audiences") && <Link className="ow-btn ow-btn--secondary" href="/merchant/audiences">Zielgruppen</Link>}{me.role === "owner" && isLocalOrigin(me.publicBaseUrl) && <Link className="ow-btn ow-btn--ghost" href="/merchant/customers/import">CSV-Vorschau</Link>}</div>
      </header>

      <form className="ow-card ow-filters" onSubmit={submit} role="search" aria-label="Karten filtern">
        <div className="ow-field" style={{ flex: "1 1 240px" }}><label htmlFor="cu-q">Kartennummer suchen</label><input id="cu-q" className="ow-input" value={filters.q} onChange={event => setFilters({ ...filters, q: event.target.value })} placeholder="z. B. K-7QX2MA" autoComplete="off" aria-describedby={searchShort ? "cu-q-hint" : undefined} />{searchShort && <span id="cu-q-hint" className="ow-hint">Vollständige Kartennummer oder mindestens 3 Zeichen der internen ID.</span>}</div>
        <div className="ow-field"><label htmlFor="cu-a">Ansicht</label><select id="cu-a" className="ow-select" value={filters.activity} onChange={event => pick({ activity: event.target.value as Activity })}>{ACTIVITY.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        {(filters.activity === "recent" || filters.activity === "drifting") && <div className="ow-field"><label htmlFor="cu-d">Zeitraum</label><select id="cu-d" className="ow-select" value={filters.days} onChange={event => pick({ days: Number(event.target.value) as Days })}>{DAYS.map(days => <option key={days} value={days}>{days} Tage</option>)}</select></div>}
        {filters.activity === "all" && <div className="ow-field"><span className="ow-label" id="cu-s">Kartenstatus</span><div className="ow-seg" role="group" aria-labelledby="cu-s">{STATUS.map(([value, label]) => <button key={value} type="button" aria-pressed={filters.status === value} onClick={() => pick({ status: value })}>{label}</button>)}</div></div>}
        <button type="submit" className="ow-btn ow-btn--primary" disabled={loading}>Suchen</button>
      </form>

      {multi && (
        <div className="ow-row">
          <div className="ow-seg" role="group" aria-label="Umfang"><button type="button" aria-pressed={!allLocations} onClick={() => { updateAddress(applied, false); }}>{scopeName}</button><button type="button" aria-pressed={allLocations} onClick={() => { updateAddress(applied, true); }}>Alle Standorte</button></div>
        </div>
      )}
      {error && <Notice tone="danger" role="alert" actions={<button type="button" className="ow-btn ow-btn--sm ow-btn--secondary" onClick={() => void run(applied)}>Erneut laden</button>}>{error}</Notice>}

      {applied.activity !== "all" && (
        <Notice tone="info" actions={applied.activity === "drifting" && !applied.q.trim() && !allLocations && scopeLocationId === me.locationId && me.role === "owner" && !(me.hiddenSurfaces ?? []).includes("campaigns")
          ? <Link className="ow-btn ow-btn--sm ow-btn--primary" href={`/merchant/campaigns?goal=winback&days=${applied.days}`}>Rückhol-Aktion vorbereiten</Link> : undefined}>
          <strong>Warum diese Karten?</strong> {activityRule(applied.activity, applied.days, me.programType === "points" ? "Punkten" : "Stempeln")}{applied.minAgeDays === 7 && " Angezeigt werden nur Karten, die vor über sieben Tagen angelegt wurden."}
        </Notice>
      )}

      <div className="ow-cust" data-detail={selected ? "open" : "closed"}>
        <section className="ow-card ow-cust-list" aria-labelledby="cu-h" aria-busy={loading}>
          <div className="ow-card-head" style={{ marginBottom: 12 }}><div><h2 id="cu-h">Karten</h2><p>{loading ? "Wird geladen …" : `${visible.length}${next ? "+" : ""} ${visible.length === 1 && !next ? "Karte" : "Karten"}${narrow ? ` am Standort ${scopeName}` : ""}`}</p></div></div>
          {loading ? <div className="ow-stack"><Skeleton height={56} /><Skeleton height={56} /><Skeleton height={56} /></div>
            : visible.length === 0 ? (unfiltered(applied) && !next
              // No cards at all yet: the way to the first one is the sign-up code at the counter.
              ? <EmptyState level={3} icon={<OwnerIcon name="users" size={24} />} title="Noch keine Karten." action={<Link href="/merchant" className={buttonClassName({ variant: "secondary", size: "sm" })}>Zur Übersicht</Link>}>Gäste melden sich über deinen Anmeldecode am Tresen an. Den Code findest du in der Übersicht.</EmptyState>
              : <EmptyState level={3} title={applied.activity === "drifting" ? "Keine länger zurückliegende Kassenaktivität." : applied.activity === "reward_ready" ? "Keine offene Prämie." : "Keine Karten gefunden."}>{next ? "Weitere Karten sind noch nicht geladen." : applied.activity === "drifting" ? `Für diese Auswahl gibt es keine Karte mit früheren bestätigten Kassenvorgängen und keinem in den letzten ${applied.days} Tagen.` : "Ändere oben die Auswahl, um weitere Karten zu sehen."}</EmptyState>)
            : <ul className="ow-members">{visible.map(member => (
              <li key={member.id}><button type="button" className="ow-member" aria-current={selected === member.id ? "true" : undefined} onClick={() => void open(member.id)}>
                <span className="ow-member-id"><strong>{member.pseudonym}</strong><small>{member.programName}{multi && allLocations ? ` · ${member.locationName}` : ""}</small></span>
                <span className="ow-member-stat"><strong className="ow-num">{member.balance} {unitOf(member)}</strong><small>{member.closedAt ? "Geschlossen" : sinceLast(member.lastQualifyingAt)} · {member.qualifyingCheckouts} {member.qualifyingCheckouts === 1 ? "Vorgang" : "Vorgänge"}</small></span>
              </button></li>))}</ul>}
          {next && !loading && <div style={{ marginTop: 12 }}><button type="button" className="ow-btn ow-btn--secondary" onClick={() => void loadMore()} disabled={more} aria-busy={more}>{more ? "Wird geladen …" : "Weitere Karten laden"}</button></div>}
        </section>

        <section className="ow-card ow-cust-detail" aria-labelledby="cu-d">
          <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm ow-cust-back" onClick={() => { setSelected(null); setDetail(null); detailToken.current++; }}>← Zur Liste</button>
          <h2 id="cu-d">Kartenverlauf</h2>
          {!selected ? <p className="ow-muted" style={{ marginTop: 8 }}>Wähle eine Karte aus der Liste.</p>
            : detailBusy ? <div className="ow-stack" style={{ marginTop: 12 }}><Skeleton height={28} width={180} /><Skeleton height={120} /></div>
            : detailError ? <div style={{ marginTop: 12 }}><Notice tone="danger" role="alert" actions={<button type="button" className="ow-btn ow-btn--sm ow-btn--secondary" onClick={() => void open(selected)}>Erneut laden</button>}>{detailError}</Notice></div>
            : detail ? (
              <div className="ow-stack" style={{ marginTop: 12 }}>
                <div className="ow-row" style={{ justifyContent: "space-between" }}><strong style={{ fontSize: "var(--text-18)" }}>{detail.member.pseudonym}</strong><span className={`ow-chip ${detail.member.closedAt ? "" : "ow-chip--ok"}`}>{detail.member.closedAt ? "Geschlossen" : "Aktiv"}</span></div>
                <p className="ow-muted">{detail.member.programName} · {detail.member.locationName}</p>
                <div className="ow-readonly"><span className="ow-muted">Aktueller Stand</span><div style={{ fontSize: "var(--text-28)", fontWeight: 700 }} className="ow-num">{detail.member.balance} {unitOf(detail.member)}</div></div>
                <dl className="ow-dl">
                  <dt>Bestätigte Vorgänge</dt><dd>{detail.member.qualifyingCheckouts}</dd>
                  <dt>Erster Vorgang</dt><dd>{when(detail.member.firstQualifyingAt)}</dd>
                  <dt>Letzter Vorgang</dt><dd>{when(detail.member.lastQualifyingAt)}</dd>
                  <dt>Erfasste Käufe</dt><dd>{detail.member.purchaseCount === null ? "Nicht erfasst" : detail.member.purchaseCount}</dd>
                  <dt>Einlösungen</dt><dd>{detail.member.redemptionCount}</dd>
                  <dt>E-Mail-Marketing</dt><dd>{detail.member.emailMarketingEligible ? "Verifiziert und zugestimmt" : "Nicht berechtigt"}</dd>
                  <dt>Als geworbene Karte</dt><dd>{referralLabel(detail.member.referralStatus)}</dd>
                  <dt>Erfolgreich geworben</dt><dd>{detail.member.qualifiedReferrals}</dd>
                  <dt>Prämienstatus</dt><dd>{eligibilityLabel(detail.member.eligibility)}</dd>
                </dl>
                {actionNotice && <Notice tone="ok" role="status">{actionNotice}</Notice>}
                {!detail.member.closedAt && (canAct
                  ? <div className="ow-row"><button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={() => setReissuing(true)}>Karte neu ausstellen</button><span className="ow-hint">Neuer Link bei verlorenem Kartenlink; Stand bleibt.</span></div>
                  : <p className="ow-hint">Korrigieren und neu ausstellen ist am Standort {detail.member.locationName} möglich. Wechsle dazu den aktiven Standort.</p>)}
                {detail.eligibleRewards.length > 0 && <div><h3 style={{ fontSize: "var(--text-16)" }}>Jetzt einlösbar</h3><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{detail.eligibleRewards.map(reward => <li key={reward.id}>{reward.title} · {reward.cost} {unitOf(detail.member)}</li>)}</ul></div>}
                <div><h3 style={{ fontSize: "var(--text-16)" }}>Vorgänge</h3><p className="ow-hint">Jede bestätigte Buchung zählt einmal, egal wie viele Stempel oder Punkte. Sie ist kein Beweis für einen Besuch.</p>
                  {detail.timeline.length === 0 ? <EmptyState level={3} size="compact" title="Noch keine Buchungen.">Buchungen und Einlösungen dieser Karte erscheinen hier.</EmptyState> : <ol className="ow-feed">{detail.timeline.map(entry => <li key={entry.id}><span><strong>{entry.kind === "award" ? "Gutschrift" : entry.kind === "redeem" ? "Einlösung" : "Korrektur"}{entry.rewardTitle ? ` · ${entry.rewardTitle}` : ""}</strong><span className="ow-muted ow-num"> · {entry.delta > 0 ? "+" : ""}{entry.delta} {unitOf(detail.member)}</span>{entry.kind !== "reversal" && <small className="ow-muted"> · {sourceLabel(entry.source)}</small>}{entry.reversed && <small className="ow-muted"> · später korrigiert</small>}{entry.kind === "reversal" && entry.reversalOfId && (() => { const original = detail.timeline.find(item => item.id === entry.reversalOfId); return <small className="ow-muted"> · {original ? `hebt ${original.kind === "award" ? "Gutschrift" : "Einlösung"} vom ${germanDate(original.createdAt, true)} auf` : "hebt einen älteren Vorgang auf"}</small>; })()}{entry.reason && <small className="ow-feed-reason">Grund: {entry.reason}</small>}</span><span className="ow-feed-side"><time dateTime={entry.createdAt}>{germanDate(entry.createdAt, true)}</time>{canAct && correctable(entry) && <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" onClick={() => setCorrecting(entry)}>Korrigieren</button>}</span></li>)}</ol>}
                  {detail.nextCursor && <button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={() => void older()} disabled={olderBusy}>{olderBusy ? "Wird geladen …" : "Ältere Vorgänge laden"}</button>}
                </div>
              </div>
            ) : null}
        </section>
      </div>
      {correcting && detail && <CorrectionDialog entry={correcting} unit={unitOf(detail.member)} locationId={me.locationId} balance={detail.member.balance} onClose={() => setCorrecting(null)} onDone={() => { const id = detail.member.id; setCorrecting(null); setActionNotice("Korrektur gebucht. Der Kontostand und der Verlauf sind aktualisiert."); void open(id, true); }} />}
      {reissuing && detail && <ReissueDialog membershipId={detail.member.id} cardLocator={detail.member.cardLocator} onClose={() => { setReissuing(false); void open(detail.member.id, true); }} onDone={() => setActionNotice("Karte neu ausgestellt. Der alte Link ist ungültig.")} />}
    </div>
  );
}
