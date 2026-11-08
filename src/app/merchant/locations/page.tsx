"use client";

import { MapPin, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { clearFlash, peekFlash } from "@/components/owner/flash";
import { programLine, type LocationList } from "@/components/owner/locations-data";
import { MORE_HREF } from "@/components/owner/nav";
import { useOwner } from "@/components/owner/owner-context";
import { MoreLabel, NumberCard, PageTitle, Row, Rows } from "@/components/owner/owner-rows";
import { ErrorNotice, LoadingBlock, nf, Notice } from "@/components/owner/owner-ui";
import { useLoad } from "@/components/owner/use-load";

/** Standorte (ENG-122c, screen 14): the totals card, then one row per location; each opens its own page, „Standort hinzufügen“ the form. */
export default function MerchantLocationsPage() {
  const owner = useOwner();
  const me = owner.me;
  const [list, reload] = useLoad<LocationList>(me?.role === "owner" ? "/api/merchant/locations" : null);
  // Set by „Standort hinzufügen“ after the new location became the active one.
  const [message] = useState(() => peekFlash());
  useEffect(() => { clearFlash(); }, []);
  if (!me) return null;
  const head = <PageTitle back={{ href: MORE_HREF, label: <MoreLabel /> }} title="Standorte" lead="Jeder Standort hat sein eigenes Programm und eigene Karten." />;
  if (me.role !== "owner") return <div className="ow-page">{head}<Notice tone="warn" role="alert">Nur die Inhaberin oder der Inhaber kann Standorte verwalten.</Notice></div>;
  if (list.state === "error") return <div className="ow-page">{head}<ErrorNotice message={list.message} onRetry={reload} /></div>;
  if (list.state !== "ok") return <div className="ow-page">{head}<LoadingBlock rows={3} height={64} /></div>;
  const l = list.data;
  return (
    <div className="ow-page">
      {head}
      {message && <div role="status"><Notice tone="ok">{message}</Notice></div>}
      {/* Kicker: copy-rest R15 FINAL; the counts' labels are live. */}
      <NumberCard label="Gesamtübersicht · alle Standorte" value={nf.format(l.totals.cards)} unit="Karten insgesamt" facts={[["Buchungen", nf.format(l.totals.awards)], ["Einlösungen", nf.format(l.totals.redemptions)]]} />
      <div className="ow-prog">
        <Rows title="Deine Standorte" help={<p>{l.countingRule}</p>}>
          {l.locations.map(location => <Row key={location.id} href={`/merchant/locations/${location.id}`} icon={MapPin} title={location.name} sub={programLine(location)} value={<>{nf.format(location.cards)}<span className="ow-sr"> Karten</span></>} big chip={location.id === me.locationId ? { label: "Aktiver Standort" } : undefined} />)}
          <Row key="new" href="/merchant/locations/new" icon={Plus} title="Standort hinzufügen" />
        </Rows>
      </div>
    </div>
  );
}
