"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiJson, ClientApiError, type MeResponse } from "@/components/client-api";
import { BrandMark } from "@/components/loyalty-ui";
import type { MerchantMember, MerchantMemberDetail, MerchantMemberList } from "@/lib/merchant-members";
import styles from "./customers.module.css";

type Filters = { q: string; status: "all" | "active" | "closed"; activity: "all" | "recorded" | "none" };
const initialFilters: Filters = { q: "", status: "all", activity: "all" };

function date(value: string | null) {
  return value ? new Date(value).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) : "Noch kein bestätigter Kassenvorgang";
}

function unit(member: MerchantMember, amount: number) {
  return `${amount > 0 ? "+" : ""}${amount} ${member.programType === "stamp" ? "Stempel" : "Punkte"}`;
}

function reason(cause: unknown) {
  return cause instanceof Error ? cause.message : "Die Daten konnten nicht geladen werden.";
}

export default function MerchantCustomersPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [applied, setApplied] = useState<Filters>(initialFilters);
  const [members, setMembers] = useState<MerchantMember[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MerchantMemberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingTimeline, setLoadingTimeline] = useState(false);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const selectedRequest = useRef(0);

  const fetchMembers = useCallback((chosen: Filters, cursor?: string) => {
    const params = new URLSearchParams({ status: chosen.status, activity: chosen.activity });
    if (chosen.q.trim()) params.set("q", chosen.q.trim());
    if (cursor) params.set("cursor", cursor);
    return apiJson<MerchantMemberList>(`/api/merchant/customers?${params}`);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([apiJson<MeResponse>("/api/me"), fetchMembers(initialFilters)]).then(([account, list]) => {
      if (!active) return;
      if (account.role === "cashier") { router.replace("/cashier"); return; }
      setMe(account);
      setMembers(list.members);
      setNextCursor(list.nextCursor);
      setLoading(false);
    }).catch(cause => {
      if (!active) return;
      if (cause instanceof ClientApiError && cause.status === 401) { router.replace("/login"); return; }
      setError(reason(cause));
      setLoading(false);
    });
    return () => { active = false; };
  }, [fetchMembers, router]);

  async function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSelectedId(null);
    setDetail(null);
    selectedRequest.current++;
    try {
      const result = await fetchMembers(filters);
      setMembers(result.members);
      setNextCursor(result.nextCursor);
      setApplied({ ...filters });
    } catch (cause) { setError(reason(cause)); }
    finally { setLoading(false); }
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const result = await fetchMembers(applied, nextCursor);
      setMembers(current => [...current, ...result.members]);
      setNextCursor(result.nextCursor);
    } catch (cause) { setError(reason(cause)); }
    finally { setLoadingMore(false); }
  }

  async function selectMember(id: string) {
    const request = ++selectedRequest.current;
    setSelectedId(id);
    setDetail(null);
    setDetailError("");
    setLoadingDetail(true);
    try {
      const result = await apiJson<MerchantMemberDetail>(`/api/merchant/customers/${encodeURIComponent(id)}`);
      if (selectedRequest.current === request) setDetail(result);
    } catch (cause) { if (selectedRequest.current === request) setDetailError(reason(cause)); }
    finally { if (selectedRequest.current === request) setLoadingDetail(false); }
  }

  async function loadOlder() {
    if (!selectedId || !detail?.nextCursor || loadingTimeline) return;
    const request = selectedRequest.current;
    const id = selectedId;
    setLoadingTimeline(true);
    setDetailError("");
    try {
      const older = await apiJson<MerchantMemberDetail>(`/api/merchant/customers/${encodeURIComponent(id)}?cursor=${encodeURIComponent(detail.nextCursor)}`);
      if (selectedRequest.current === request) setDetail(current => current && ({ ...older, timeline: [...current.timeline, ...older.timeline] }));
    } catch (cause) { if (selectedRequest.current === request) setDetailError(reason(cause)); }
    finally { if (selectedRequest.current === request) setLoadingTimeline(false); }
  }

  return <div className="app-page">
    <header className="app-header"><div className="app-header-inner"><Link href="/merchant" aria-label="Zur Übersicht"><BrandMark /></Link><nav aria-label="Hauptnavigation"><Link href="/merchant">Übersicht</Link><Link href="/merchant/program">Programm</Link><Link href="/merchant/customers" aria-current="page">Kundenkarten</Link>{me?.role === "owner" && <Link href="/merchant/staff">Team</Link>}<Link href="/cashier">Kasse</Link></nav><span className="app-header-location">Kundenkarten</span></div></header>
    <main className={`app-container ${styles.main}`}>
      <div className="app-intro"><span className="eyebrow"><span className="eyebrow-dot" /> KARTEN &amp; VORGÄNGE</span><h1>Kundenkarten</h1><p>Pseudonyme Karten, bestätigte Kassenvorgänge und der aktuelle Saldo an deinem Standort.</p></div>
      <form className={`app-panel ${styles.filters}`} onSubmit={applyFilters}>
        <label>Karten-ID suchen<input value={filters.q} onChange={event => setFilters(current => ({ ...current, q: event.target.value }))} placeholder="Erste 3 Zeichen der Karten-ID" autoComplete="off" /></label>
        <label>Kartenstatus<select value={filters.status} onChange={event => setFilters(current => ({ ...current, status: event.target.value as Filters["status"] }))}><option value="all">Alle Karten</option><option value="active">Aktiv</option><option value="closed">Geschlossen</option></select></label>
        <label>Kassenaktivität<select value={filters.activity} onChange={event => setFilters(current => ({ ...current, activity: event.target.value as Filters["activity"] }))}><option value="all">Alle</option><option value="recorded">Mit bestätigtem Vorgang</option><option value="none">Ohne bestätigten Vorgang</option></select></label>
        <button className="button button--ink" type="submit" disabled={loading}>Anzeigen</button>
      </form>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.grid}>
        <section className={`app-panel ${styles.list}`} aria-labelledby="customer-list-heading">
          <div className={styles.sectionHead}><div><span className="tiny-label">DEIN STANDORT</span><h2 id="customer-list-heading">Kartenübersicht</h2></div><span className={styles.count}>{members.length}{nextCursor ? "+" : ""} Karten</span></div>
          {loading ? <p className={styles.muted}>Karten werden geladen …</p> : members.length === 0 ? <p className={styles.muted}>Keine Karten für diese Suche gefunden.</p> : <ul className={styles.memberList}>{members.map(member => <li key={member.id}><button type="button" className={`${styles.memberButton} ${selectedId === member.id ? styles.selected : ""}`} onClick={() => void selectMember(member.id)} aria-current={selectedId === member.id ? "true" : undefined}><span className={styles.memberIdentity}><strong>{member.pseudonym}</strong><small>{member.programName} · {member.locationName}</small></span><span className={styles.memberStats}><strong>{member.balance} {member.programType === "stamp" ? "Stempel" : "Punkte"}</strong><small>{member.qualifyingCheckouts} bestätigte Kassenvorgänge · {member.closedAt ? "geschlossen" : "aktiv"}</small></span></button></li>)}</ul>}
          {nextCursor && <button type="button" className="button button--outline" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Wird geladen …" : "Weitere Karten laden"}</button>}
        </section>
        <section className={`app-panel ${styles.detail}`} aria-labelledby="customer-detail-heading">
          <div className={styles.sectionHead}><div><span className="tiny-label">EINZELNE KARTE</span><h2 id="customer-detail-heading">Kartenverlauf</h2></div></div>
          {!selectedId ? <p className={styles.muted}>Wähle eine Karte aus der Übersicht.</p> : loadingDetail ? <p className={styles.muted}>Kartenverlauf wird geladen …</p> : !detail ? <p className={styles.muted}>Der Kartenverlauf ist nicht verfügbar.</p> : <>
            <div className={styles.detailIdentity}><strong>{detail.member.pseudonym}</strong><span>{detail.member.closedAt ? "Geschlossen" : "Aktiv"}</span></div>
            <p className={styles.detailContext}>{detail.member.programName} · {detail.member.locationName}</p>
            <div className={styles.balance}><span>Aktueller Saldo</span><strong>{detail.member.balance} {detail.member.programType === "stamp" ? "Stempel" : "Punkte"}</strong></div>
            <dl className={styles.facts}>
              <div><dt>Bestätigte Kassenvorgänge</dt><dd>{detail.member.qualifyingCheckouts}</dd></div>
              <div><dt>Erster bestätigter Vorgang</dt><dd>{date(detail.member.firstQualifyingAt)}</dd></div>
              <div><dt>Letzter bestätigter Vorgang</dt><dd>{date(detail.member.lastQualifyingAt)}</dd></div>
              <div><dt>Erfasste Käufe</dt><dd>{detail.member.purchaseCount === null ? "Nicht erfasst" : detail.member.purchaseCount}</dd></div>
              <div><dt>Einlösungen</dt><dd>{detail.member.redemptionCount}</dd></div>
              <div><dt>E-Mail-Marketing</dt><dd>{detail.member.emailMarketingEligible ? "Verifiziert und zugestimmt" : "Nicht berechtigt"}</dd></div>
              <div><dt>Empfehlungsstatus</dt><dd>Nicht verfügbar</dd></div>
              <div><dt>Prämienstatus</dt><dd>{eligibilityLabel(detail.member.eligibility)}</dd></div>
            </dl>
            {detail.eligibleRewards.length > 0 && <div className={styles.rewards}><h3>Jetzt einlösbar</h3><ul>{detail.eligibleRewards.map(reward => <li key={reward.id}>{reward.title} · {reward.cost} {detail.member.programType === "stamp" ? "Stempel" : "Punkte"}</li>)}</ul></div>}
            <div className={styles.timeline}><h3>Vorgänge</h3><p>Jeder bestätigte Kassenvorgang zählt einmal, unabhängig von der vergebenen Menge. Das ist kein Nachweis eines physischen Besuchs.</p>{detail.timeline.length === 0 ? <p className={styles.muted}>Noch keine Buchungen.</p> : <ol>{detail.timeline.map(entry => <li key={entry.id}><div><strong>{entry.kind === "award" ? "Gutschrift" : entry.kind === "redeem" ? "Einlösung" : "Korrektur"}{entry.rewardTitle ? ` · ${entry.rewardTitle}` : ""}</strong><time dateTime={entry.createdAt}>{date(entry.createdAt)}</time></div><span>{unit(detail.member, entry.delta)}</span>{entry.reversed && <small>Später korrigiert</small>}</li>)}</ol>}{detail.nextCursor && <button type="button" className="button button--outline" disabled={loadingTimeline} onClick={() => void loadOlder()}>{loadingTimeline ? "Wird geladen …" : "Ältere Vorgänge laden"}</button>}</div>
          </>}
          {detailError && <p role="alert" className={styles.error}>{detailError}</p>}
        </section>
      </div>
    </main>
  </div>;
}

function eligibilityLabel(value: MerchantMember["eligibility"]) {
  switch (value) {
    case "eligible": return "Prämie einlösbar";
    case "not_yet": return "Noch nicht einlösbar";
    case "not_configured": return "Keine aktive Prämie";
    case "closed": return "Karte geschlossen";
    case "not_checked": return "Noch nicht geprüft";
    default: return "Nicht verfügbar";
  }
}
