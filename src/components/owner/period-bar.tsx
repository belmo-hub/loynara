"use client";

import type { ReactNode } from "react";

/** Reporting window select shared by the tenant-wide reports. */
export function PeriodBar({ id, value, onChange, meta }: { id: string; value: 30 | 90; onChange: (days: 30 | 90) => void; meta?: ReactNode }) {
  return (
    <div className="ow-row">
      <label htmlFor={id} className="ow-label">Zeitraum</label>
      <select id={id} className="ow-select" style={{ width: "auto", minWidth: 180 }} value={value} onChange={event => onChange(Number(event.target.value) as 30 | 90)}>
        <option value={30}>Letzte 30 Tage</option><option value={90}>Letzte 90 Tage</option>
      </select>
      {meta && <span className="ow-muted" style={{ fontSize: 14 }}>{meta}</span>}
    </div>
  );
}

/** Shown only when the business has more than one location; with one location it would be noise. */
export const ALL_LOCATIONS_NOTE = "Diese Auswertung gilt für alle Standorte zusammen.";
