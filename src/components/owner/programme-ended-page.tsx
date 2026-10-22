"use client";

import { germanDate } from "@/lib/programme-end-date";
import type { EndedInfo } from "./owner-context";

/** The whole owner area once the programme has ended: the data export for 30 days, and nothing that could change the programme. */
export function ProgrammeEndedPage({ info }: { info: EndedInfo }) {
  const owner = info.role === "owner";
  return (
    <div className="ow-page" style={{ maxWidth: 640 }}>
      <section className="ow-card ow-stack ow-arrive" aria-labelledby="ow-ended-title">
        <h1 id="ow-ended-title">Programm beendet am {germanDate(info.endedOn)}</h1>
        <p>Das Programm von {info.businessName} läuft nicht mehr. Die Stände deiner Kunden bleiben gespeichert.</p>
        {!owner ? <p>Bitte wende dich an die Inhaberin oder den Inhaber.</p>
          : info.exportOpen ? <>
            <p>Du kannst deine Daten noch bis zum {germanDate(info.exportUntil)} herunterladen.</p>
            <div className="ow-row">
              <a className="ow-btn ow-btn--secondary" href="/api/merchant/export" download>Vollständigen Export herunterladen</a>
              <a className="ow-btn ow-btn--ghost" href="/api/merchant/export?format=karten" download>Karten (CSV)</a>
              <a className="ow-btn ow-btn--ghost" href="/api/merchant/export?format=buchungen" download>Buchungen (CSV)</a>
            </div>
          </>
          : <p>Der Datenexport war bis zum {germanDate(info.exportUntil)} möglich. Bitte wende dich an den Support.</p>}
      </section>
    </div>
  );
}
