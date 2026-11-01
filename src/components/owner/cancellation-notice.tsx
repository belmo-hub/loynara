"use client";

import Link from "next/link";
import type { MeResponse } from "@/components/client-api";
import { cancellationTimeline, germanDate } from "@/lib/programme-end-date";
import { useOwner } from "./owner-context";

/**
 * The shop's end date, on Übersicht, Geschäft and Abrechnung: the date, what works until then, and the next step. A
 * cancellation binds from its arrival (ENG-167). Until the end everything works, redemptions included. The link to „Programm beenden“ appears only where that page is offered (withheld on production).
 */
export function CancellationNotice({ me, now }: { me: MeResponse; now?: Date }) {
  const { locations } = useOwner();
  if (!me.cancellationEndDate) return null;
  const endDate = me.cancellationEndDate;
  const isOwner = me.role === "owner";
  const settings = isOwner && !(me.hiddenSurfaces ?? []).includes("cancellation");
  const { daysLeft, phase, exportUntil } = cancellationTimeline(endDate, now);
  // ENG-167 (Legal, 1 Nov): a cancellation binds from its arrival, so the requested and confirmed phases are one: C23 as the
  // headline, then the days left, the last day or the end reached; the old „… bis wir das Enddatum bestätigen“ is gone.
  const running = phase === "running" ? `Noch ${daysLeft} ${daysLeft === 1 ? "Tag" : "Tage"}. Bis dahin läuft alles normal: Deine Kunden sammeln weiter und lösen ihre Prämien ein.`
    : phase === "last-day" ? "Heute ist der letzte Tag. Bis Mitternacht läuft alles normal, auch das Einlösen von Prämien."
      : "Das Enddatum ist erreicht. Das Programm wird in Kürze beendet.";
  return (
    <section className="ow-card ow-next" aria-labelledby="ow-ends-title" data-state="cancelled">
      <h2 id="ow-ends-title">Programm endet{locations.length > 1 ? ` · ${me.locationName}` : ""}</h2>
      <p className="ow-next-text">Gekündigt: Ende am {germanDate(endDate)}.</p>
      <p className="ow-muted">{running}</p>
      <p className="ow-muted">{phase !== "past" && "Sag es deinen Kunden, damit sie ihre Prämien noch einlösen."}{isOwner && `${phase !== "past" ? " " : ""}Deine Daten kannst du bis zum ${germanDate(exportUntil)} herunterladen.`}</p>
      {settings && phase !== "past" && <div><Link className="ow-btn ow-btn--secondary" href="/merchant/settings/cancel">Text für deine Kunden</Link></div>}
    </section>
  );
}
