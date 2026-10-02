"use client";

import Link from "next/link";
import { JoinCard } from "@/components/owner/join-card";
import { useOwner } from "@/components/owner/owner-context";
import { Notice } from "@/components/owner/owner-ui";

export default function MerchantSettingsPage() {
  const { me, locations, hiddenSurfaces } = useOwner();
  if (!me) return null;
  if (me.role !== "owner") return <div className="ow-page"><Notice tone="warn">Die Einstellungen sind Inhaber:innen vorbehalten.</Notice></div>;
  return (
    <div className="ow-page">
      <header className="ow-pagehead"><div><p className="ow-eyebrow">Einstellungen</p><h1>Geschäft</h1><p>Name, Standort und Zugang für deine Kunden.</p></div></header>
      <div className="ow-two">
        <section className="ow-card ow-stack" aria-labelledby="ow-biz-title">
          <h2 id="ow-biz-title">Dein Geschäft</h2>
          <dl className="ow-dl">
            <dt>Geschäft</dt><dd>{me.businessName}</dd>
            <dt>Aktiver Standort</dt><dd>{me.locationName}</dd>
            <dt>Standorte</dt><dd>{locations.length || 1}</dd>
            <dt>Programm</dt><dd>{me.programType === "stamp" ? "Stempelkarte" : "Punktekarte"}</dd>
          </dl>
          <div className="ow-row">
            <Link className="ow-btn ow-btn--secondary ow-btn--sm" href="/merchant/program/card">{hiddenSurfaces.includes("cardLogo") ? "Name und Farbe ändern" : "Name, Farbe und Logo ändern"}</Link>
            <Link className="ow-btn ow-btn--ghost ow-btn--sm" href="/merchant/locations">Standorte verwalten</Link>
          </div>
        </section>
        <JoinCard me={me} exportUrl="/api/merchant/export" />
      </div>
    </div>
  );
}
