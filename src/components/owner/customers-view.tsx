"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { apiJson } from "@/components/client-api";
import { parseCardLocator } from "@/lib/card-locator";
import type { MerchantMember, MerchantMemberDetail, MerchantMemberList } from "@/lib/merchant-members";
import { useOwner } from "./owner-context";
import { CorrectionDialog, correctable, ReissueDialog, sourceLabel } from "./card-actions";
import { germanDate, Notice, Skeleton } from "./owner-ui";

type Filters = { q: string; status: "all" | "active" | "closed"; activity: "all" | "recorded" | "none" };
const INITIAL: Filters = { q: "", status: "all", activity: "all" };
const STATUS: Array<[Filters["status"], string]> = [["all", "Alle"], ["active", "Aktiv"], ["closed", "Geschlossen"]];
const ACTIVITY: Array<[Filters["activity"], string]> = [["all", "Alle"], ["recorded", "Mit Vorgang"], ["none", "Ohne Vorgang"]];
const MAX_AUTO_PAGES = 6;

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
  const [filters, setFilters] = useState<Filters>(INITIAL);
  const [applied, setApplied] = useState<Filters>(INITIAL);
  const [allLocations, setAllLocations] = useState(false);
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

  // The API returns every location for owners and exposes only the location name. Narrowing by name is only safe
  // when the name is unique, so the "active location" scope is offered only then.
  const multi = me.role === "owner" && owner.locations.length > 1;
  const nameUnique = owner.locations.filter(location => location.name === me.locationName).length === 1;
  const narrow = multi && nameUnique && !allLocations;
  const visible = useMemo(() => narrow ? members.filter(member => member.locationName === me.locationName) : members, [members, narrow, me.locationName]);

  const fetchPage = useCallback((chosen: Filters, cursor?: string) => {
    const params = new URLSearchParams({ status: chosen.status, activity: chosen.activity });
    if (chosen.q.trim()) params.set("q", chosen.q.trim());
    if (cursor) params.set("cursor", cursor);
    return apiJson<MerchantMemberList>(`/api/merchant/customers?${params}`);
  }, []);

  // Pages until at least one card of the wanted location is visible (bounded), or a single page when not narrowing.
  const fetchVisible = useCallback(async (chosen: Filters, start: string | undefined, onlyLocation: string | null) => {
    let cursor: string | null | undefined = start; let collected: MerchantMember[] = []; let pages = 0;
    do {
      const page: MerchantMemberList = await fetchPage(chosen, cursor ?? undefined);
      collected = collected.concat(page.members); cursor = page.nextCursor; pages++;
    } while (cursor && onlyLocation && pages < MAX_AUTO_PAGES && !collected.some(member => member.locationName === onlyLocation));
    return { members: collected, next: cursor ?? null };
  }, [fetchPage]);
  const narrowName = narrow ? me.locationName : null;
  // The shell remounts this view when the active location changes. Scope buttons
  // run their own filtered request; they must not trigger this initial load again.
  const initialScope = useRef(narrowName);

  const run = useCallback(async (chosen: Filters, override?: string | null) => {
    const mine = ++token.current;
    setLoading(true); setError(""); setSelected(null); setDetail(null); detailToken.current++;
    try {
      const page = await fetchVisible(chosen, undefined, override === undefined ? narrowName : override);
      if (token.current !== mine) return;
      setMembers(page.members); setNext(page.next); setApplied(chosen);
    } catch (cause) { if (token.current === mine) setError(reason(cause)); }
    finally { if (token.current === mine) setLoading(false); }
  }, [fetchVisible, narrowName]);

  useEffect(() => {
    let live = true;
    const mine = ++token.current;
    void fetchVisible(INITIAL, undefined, initialScope.current).then(page => { if (live && token.current === mine) { setMembers(page.members); setNext(page.next); setLoading(false); } })
      .catch(cause => { if (live && token.current === mine) { setError(reason(cause)); setLoading(false); } });
    return () => { live = false; };
  }, [fetchVisible]);

  async function loadMore() {
    if (!next || more) return;
    setMore(true); setError("");
    const mine = token.current;
    try {
      const page = await fetchVisible(applied, next, narrowName);
      if (token.current !== mine) return;
      setMembers(current => [...current, ...page.members]); setNext(page.next);
    } catch (cause) { setError(reason(cause)); }
    finally { setMore(false); }
  }

  function submit(event: FormEvent) { event.preventDefault(); void run(filters); }
  function pick(patch: Partial<Filters>) { const chosen = { ...filters, ...patch }; setFilters(chosen); void run(chosen); }

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
        <div><p className="ow-eyebrow">Kunden</p><h1>Kundenkarten</h1><p>Pseudonyme Karten mit Kartennummer, bestätigten Kassenvorgängen und aktuellem Stand. Namen und Kontaktdaten zeigt Loynara hier nicht.</p></div>
        <div className="ow-row">{!(me.hiddenSurfaces ?? []).includes("audiences") && <Link className="ow-btn ow-btn--secondary" href="/merchant/audiences">Zielgruppen</Link>}{me.role === "owner" && isLocalOrigin(me.publicBaseUrl) && <Link className="ow-btn ow-btn--ghost" href="/merchant/customers/import">CSV-Vorschau</Link>}</div>
      </header>

      <form className="ow-card ow-filters" onSubmit={submit} role="search" aria-label="Karten filtern">
        <div className="ow-field" style={{ flex: "1 1 240px" }}><label htmlFor="cu-q">Kartennummer suchen</label><input id="cu-q" className="ow-input" value={filters.q} onChange={event => setFilters({ ...filters, q: event.target.value })} placeholder="z. B. K-7QX2MA" autoComplete="off" aria-describedby={searchShort ? "cu-q-hint" : undefined} />{searchShort && <span id="cu-q-hint" className="ow-hint">Vollständige Kartennummer oder mindestens 3 Zeichen der internen ID.</span>}</div>
        <div className="ow-field"><span className="ow-label" id="cu-s">Kartenstatus</span><div className="ow-seg" role="group" aria-labelledby="cu-s">{STATUS.map(([value, label]) => <button key={value} type="button" aria-pressed={filters.status === value} onClick={() => pick({ status: value })}>{label}</button>)}</div></div>
        <div className="ow-field"><span className="ow-label" id="cu-a">Kassenaktivität</span><div className="ow-seg" role="group" aria-labelledby="cu-a">{ACTIVITY.map(([value, label]) => <button key={value} type="button" aria-pressed={filters.activity === value} onClick={() => pick({ activity: value })}>{label}</button>)}</div></div>
        <button type="submit" className="ow-btn ow-btn--primary" disabled={loading}>Suchen</button>
      </form>

      {multi && (
        <div className="ow-row">
          {nameUnique
            ? <div className="ow-seg" role="group" aria-label="Umfang"><button type="button" aria-pressed={!allLocations} onClick={() => { setAllLocations(false); void run(applied, me.locationName); }}>{me.locationName}</button><button type="button" aria-pressed={allLocations} onClick={() => { setAllLocations(true); void run(applied, null); }}>Alle Standorte</button></div>
            : <Notice tone="warn">Die Liste zeigt alle Standorte. Zwei Standorte heißen gleich, deshalb ist keine Eingrenzung möglich.</Notice>}
        </div>
      )}
      {error && <Notice tone="danger" role="alert" actions={<button type="button" className="ow-btn ow-btn--sm ow-btn--secondary" onClick={() => void run(applied)}>Erneut laden</button>}>{error}</Notice>}

      <div className="ow-cust" data-detail={selected ? "open" : "closed"}>
        <section className="ow-card ow-cust-list" aria-labelledby="cu-h" aria-busy={loading}>
          <div className="ow-card-head" style={{ marginBottom: 12 }}><div><h2 id="cu-h">Karten</h2><p>{loading ? "Wird geladen …" : `${visible.length}${next ? "+" : ""} ${visible.length === 1 && !next ? "Karte" : "Karten"}${narrow ? ` am Standort ${me.locationName}` : ""}`}</p></div></div>
          {loading ? <div className="ow-stack"><Skeleton height={56} /><Skeleton height={56} /><Skeleton height={56} /></div>
            : visible.length === 0 ? <div className="ow-empty"><strong>Keine Karten gefunden.</strong>{next ? "Weitere Karten sind noch nicht geladen." : "Für diese Auswahl gibt es keine Karten."}</div>
            : <ul className="ow-members">{visible.map(member => (
              <li key={member.id}><button type="button" className="ow-member" aria-current={selected === member.id ? "true" : undefined} onClick={() => void open(member.id)}>
                <span className="ow-member-id"><strong>{member.pseudonym}</strong><small>{member.programName}{multi && allLocations ? ` · ${member.locationName}` : ""}</small></span>
                <span className="ow-member-stat"><strong className="ow-num">{member.balance} {unitOf(member)}</strong><small>{member.qualifyingCheckouts} {member.qualifyingCheckouts === 1 ? "Vorgang" : "Vorgänge"} · {member.closedAt ? "geschlossen" : "aktiv"}</small></span>
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
                <div className="ow-row" style={{ justifyContent: "space-between" }}><strong style={{ fontSize: 18 }}>{detail.member.pseudonym}</strong><span className={`ow-chip ${detail.member.closedAt ? "" : "ow-chip--ok"}`}>{detail.member.closedAt ? "Geschlossen" : "Aktiv"}</span></div>
                <p className="ow-muted">{detail.member.programName} · {detail.member.locationName}</p>
                <div className="ow-readonly"><span className="ow-muted">Aktueller Stand</span><div style={{ fontSize: 26, fontWeight: 700 }} className="ow-num">{detail.member.balance} {unitOf(detail.member)}</div></div>
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
                {detail.eligibleRewards.length > 0 && <div><h3 style={{ fontSize: 15 }}>Jetzt einlösbar</h3><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{detail.eligibleRewards.map(reward => <li key={reward.id}>{reward.title} · {reward.cost} {unitOf(detail.member)}</li>)}</ul></div>}
                <div><h3 style={{ fontSize: 15 }}>Vorgänge</h3><p className="ow-hint">Jeder bestätigte Kassenvorgang zählt einmal, unabhängig von der vergebenen Menge. Das ist kein Nachweis eines Besuchs.</p>
                  {detail.timeline.length === 0 ? <p className="ow-muted">Noch keine Buchungen.</p> : <ol className="ow-feed">{detail.timeline.map(entry => <li key={entry.id}><span><strong>{entry.kind === "award" ? "Gutschrift" : entry.kind === "redeem" ? "Einlösung" : "Korrektur"}{entry.rewardTitle ? ` · ${entry.rewardTitle}` : ""}</strong><span className="ow-muted ow-num"> · {entry.delta > 0 ? "+" : ""}{entry.delta} {unitOf(detail.member)}</span>{entry.kind !== "reversal" && <small className="ow-muted"> · {sourceLabel(entry.source)}</small>}{entry.reversed && <small className="ow-muted"> · später korrigiert</small>}{entry.reason && <small className="ow-feed-reason">Grund: {entry.reason}</small>}</span><span className="ow-feed-side"><time dateTime={entry.createdAt}>{germanDate(entry.createdAt, true)}</time>{canAct && correctable(entry) && <button type="button" className="ow-btn ow-btn--ghost ow-btn--sm" onClick={() => setCorrecting(entry)}>Korrigieren</button>}</span></li>)}</ol>}
                  {detail.nextCursor && <button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={() => void older()} disabled={olderBusy}>{olderBusy ? "Wird geladen …" : "Ältere Vorgänge laden"}</button>}
                </div>
              </div>
            ) : null}
        </section>
      </div>
      {correcting && detail && <CorrectionDialog entry={correcting} unit={unitOf(detail.member)} locationId={me.locationId} onClose={() => setCorrecting(null)} onDone={() => { const id = detail.member.id; setCorrecting(null); setActionNotice("Korrektur gebucht. Der Kontostand und der Verlauf sind aktualisiert."); void open(id, true); }} />}
      {reissuing && detail && <ReissueDialog membershipId={detail.member.id} cardLocator={detail.member.cardLocator} onClose={() => { setReissuing(false); void open(detail.member.id, true); }} onDone={() => setActionNotice("Karte neu ausgestellt. Der alte Link ist ungültig.")} />}
    </div>
  );
}
