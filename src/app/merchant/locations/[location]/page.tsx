"use client";

import { notFound, useParams } from "next/navigation";
import { programLine, type LocationList } from "@/components/owner/locations-data";
import { useOwner } from "@/components/owner/owner-context";
import { NumberCard, PageTitle } from "@/components/owner/owner-rows";
import { GuardedLink } from "@/components/owner/owner-shell";
import { ErrorNotice, LoadingBlock, nf, Notice, OwnerIcon } from "@/components/owner/owner-ui";
import { useLoad } from "@/components/owner/use-load";

const BACK = { href: "/merchant/locations", label: "Standorte" };

/** One location (ENG-122c): its programme and lifetime counts as on the old location card, and the switch or the way to its programme. */
export default function LocationPage() {
  const { location: id } = useParams<{ location: string }>();
  const owner = useOwner();
  const me = owner.me;
  const [list, reload] = useLoad<LocationList>(me?.role === "owner" ? "/api/merchant/locations" : null);
  if (!me) return null;
  const fallback = <PageTitle back={BACK} title="Standorte" />;
  if (me.role !== "owner") return <div className="ow-page">{fallback}<Notice tone="warn" role="alert">Nur Inhaber:innen können Standorte verwalten.</Notice></div>;
  if (list.state === "error") return <div className="ow-page">{fallback}<ErrorNotice message={list.message} onRetry={reload} /></div>;
  if (list.state !== "ok") return <div className="ow-page">{fallback}<LoadingBlock rows={2} /></div>;
  const location = list.data.locations.find(item => item.id === id);
  if (!location) notFound();
  const active = location.id === me.locationId;
  return (
    <div className="ow-page ow-qpage">
      <PageTitle back={BACK} title={location.name} lead={`${location.city} · ${location.country}`} />
      <div className="ow-q">
        {active && <p><span className="ow-chip ow-chip--ok ow-chip--state"><OwnerIcon name="check" size={14} />Aktiver Standort</span></p>}
        <NumberCard label={programLine(location)} value={nf.format(location.cards)} unit="Karten" facts={[["Buchungen", nf.format(location.awards)], ["Einlösungen", nf.format(location.redemptions)], ["Aktive Teamzugänge", nf.format(location.activeStaff)]]} />
        {/* The shell shows nothing else of a failed switch below the desktop sidebar. */}
        {owner.switchError && <ErrorNotice message={owner.switchError} />}
        <div className="ow-qsave">
          {active
            ? <GuardedLink href="/merchant/program" className="ow-btn ow-btn--secondary">Programm ansehen</GuardedLink>
            : <button type="button" className="ow-btn ow-btn--primary" disabled={owner.switching} onClick={() => owner.switchLocation(location.id)}>Als aktiven Standort wählen</button>}
        </div>
      </div>
    </div>
  );
}
