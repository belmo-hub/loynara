"use client";

import Link from "next/link";
import type { MeResponse } from "@/components/client-api";
import { cancellationTimeline, germanDate } from "@/lib/programme-end-date";
import { useOwner } from "./owner-context";

/**
 * A requested or confirmed end date, on Übersicht and Abrechnung: the date, what works until then, and the next step.
 * Requested = provisional ("Voraussichtlich"), confirmed = the operator has set the date. Until the end everything works,
 * redemptions included. The Einstellungen links appear only where the cancel card is offered (it is withheld on production).
 */
export function CancellationNotice({ me, now }: { me: MeResponse; now?: Date }) {
  const { locations } = useOwner();
  if (!me.cancellationEndDate) return null;
  const endDate = me.cancellationEndDate;
  const confirmed = me.cancellationConfirmed === true;
  const isOwner = me.role === "owner";
  const settings = isOwner && !(me.hiddenSurfaces ?? []).includes("cancellation");
  const { daysLeft, phase, exportUntil } = cancellationTimeline(endDate, now);
  const running = confirmed
    ? phase === "running" ? `Noch ${daysLeft} ${daysLeft === 1 ? "Tag" : "Tage"}. Bis dahin läuft alles normal: Deine Kunden sammeln weiter und lösen ihre Prämien ein.`
      : phase === "last-day" ? "Heute ist der letzte Tag. Bis Mitternacht läuft alles normal, auch das Einlösen von Prämien."
        : "Das Enddatum ist erreicht. Das Programm wird in Kürze beendet."
    : phase === "running" ? "Wir bestätigen dir das genaue Enddatum per E-Mail. Bis dahin läuft alles normal, auch das Einlösen von Prämien."
      : "Das vorläufige Datum ist erreicht. Dein Programm läuft weiter, bis wir das Enddatum bestätigen.";
  return (
    <section className="ow-card ow-next" aria-labelledby="ow-ends-title" data-state={confirmed ? "confirmed" : "requested"}>
      <h2 id="ow-ends-title" className="ow-eyebrow">Programm endet{locations.length > 1 ? ` · ${me.locationName}` : ""}</h2>
      <p className="ow-next-text">{confirmed ? `Dein Programm endet am ${germanDate(endDate)}.` : `Voraussichtlich bis zum ${germanDate(endDate)}.`}</p>
      <p className="ow-muted">{running}</p>
      {confirmed && <p className="ow-muted">{phase !== "past" && "Sag es deinen Kunden, damit sie ihre Prämien noch einlösen."}{isOwner && `${phase !== "past" ? " " : ""}Deine Daten kannst du bis zum ${germanDate(exportUntil)} herunterladen.`}</p>}
      {settings && phase !== "past" && <div><Link className="ow-btn ow-btn--secondary" href="/merchant/settings">{confirmed ? "Text für deine Kunden" : "Kündigung in den Einstellungen"}</Link></div>}
    </section>
  );
}
