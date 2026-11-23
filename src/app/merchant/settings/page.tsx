"use client";

import { Check, MapPin, Palette, Phone, Scale, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { postJson } from "@/components/client-api";
import { BookingAvvRows } from "@/components/owner/booking-avv";
import { CancellationNotice } from "@/components/owner/cancellation-notice";
import { MORE_HREF } from "@/components/owner/nav";
import { useOwner, type OwnerLocation } from "@/components/owner/owner-context";
import { MoreLabel, PageTitle, Row, Rows } from "@/components/owner/owner-rows";
import { GuardedLink } from "@/components/owner/owner-shell";
import { ErrorNotice, Notice } from "@/components/owner/owner-ui";
import { SwitchRow } from "@/components/owner/question-form";
import { useLoad } from "@/components/owner/use-load";
import { readReturn, writeReturn } from "@/components/owner/program-list";
import { FooterPreview, SENDER_ANCHOR, SENDER_LIST, senderOf, senderOffered, senderStatus } from "@/components/owner/sender";
import { senderHref, type SenderQuestion } from "@/components/owner/sender-routes";
import type { MeResponse } from "@/components/client-api";
import type { SenderPart } from "@/lib/sender-details";

/** Geschäft (ENG-122c, screen 13): the card's names, the active location, the weekly report, and „Programm beenden“ last. */
export default function MerchantSettingsPage() {
  const { me, locations, hiddenSurfaces } = useOwner();
  if (!me) return null;
  const head = <PageTitle back={{ href: MORE_HREF, label: <MoreLabel /> }} title="Geschäft" lead="Name, Standort und Zugang für deine Kunden." />;
  if (me.role !== "owner") return <div className="ow-page">{head}<Notice>Die Einstellungen sind Inhaber:innen vorbehalten.</Notice></div>;
  const active = locations.find(location => location.id === me.locationId);
  const programName = active?.programName;
  const sender = senderOffered(hiddenSurfaces) && active ? <SenderRows me={me} locations={locations} active={active} /> : null;
  const preview = sender && senderStatus(me, locations).complete && active ? <FooterPreview sender={senderOf(me, active)} title="So steht es unter Erinnerungen und Kampagnen" /> : null;
  return (
    <div className="ow-page">
      {head}
      <CancellationNotice me={me} />
      <div className="ow-split" data-aside={preview ? true : undefined}>
      <div className="ow-prog">
        <Rows title="Dein Geschäft">
          {/* R14; where the logo upload is withheld the row promises no logo (W38's rule). */}
          <Row key="card" href="/merchant/program/card" icon={Palette} title={hiddenSurfaces.includes("cardLogo") ? "Name und Farbe" : "Name, Logo und Farbe"} sub={programName ? `${me.businessName} · ${programName}` : me.businessName} />
          <Row key="location" href="/merchant/locations" icon={MapPin} title="Aktiver Standort" value={me.locationName} off />
        </Rows>
        {sender}
        <Rows title="E-Mail"><WeeklyReport key="weekly" /></Rows>
        {/* Legal § 6: only shops that signed up online accept in the app; a paper-contract shop gets an addendum. */}
        {me.bookingContractsAcceptedAt !== undefined && <BookingAvvRows acceptedAt={me.bookingContractsAcceptedAt} />}
      </div>
      {preview && <aside className="ow-split-aside">{preview}</aside>}
      </div>
      {/* The request is withheld on production until Legal's gate (pilot surfaces); a requested end shows as the notice above. */}
      {!hiddenSurfaces.includes("cancellation") && !me.cancellationEndDate && <div><GuardedLink href="/merchant/settings/cancel" className="ow-qlink" data-danger="">Programm beenden</GuardedLink></div>}
    </div>
  );
}

// Deliberately not a pilot surface: it only controls owner mail and must stay reachable on production. Saves on the switch.
function WeeklyReport() {
  const [setting, reload] = useLoad<{ enabled: boolean }>("/api/merchant/weekly-report");
  const [saved, setSaved] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const enabled = saved ?? (setting.state === "ok" ? setting.data.enabled : null);
  async function change(next: boolean) {
    setSaving(true); setError("");
    try { setSaved((await postJson<{ enabled: boolean }>("/api/merchant/weekly-report", { enabled: next })).enabled); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen."); }
    finally { setSaving(false); }
  }
  if (setting.state === "error") return <ErrorNotice message={setting.message} onRetry={reload} />;
  return <>
    <SwitchRow label="Wochenbericht per E-Mail senden" sub="Jeden Montag um 7 Uhr eine E-Mail mit Buchungen, neuen Karten, Stammkunden, zurückgewonnenen Kunden und eingelösten Prämien der Vorwoche." checked={enabled ?? false} disabled={enabled === null || saving} onChange={change} />
    {error && <Notice tone="danger">{error}</Notice>}
  </>;
}

/**
 * Absender deiner E-Mails (ENG-164, A01/A02/A15): a row per part with its value or „Fehlt“, then #67's note, or the footer
 * preview once every location and the business are complete (on a phone here; beside the rows from 1024 px). A location's
 * part missing elsewhere names that location and opens its screen, never switching the active location.
 */
function SenderRows({ me, locations, active }: { me: MeResponse; locations: OwnerLocation[]; active: OwnerLocation }) {
  const status = senderStatus(me, locations);
  const [back] = useState(() => readReturn(SENDER_LIST));
  const [toast, setToast] = useState(Boolean(back?.saved));
  useEffect(() => { writeReturn(null, SENDER_LIST); }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(false), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const values = senderOf(me, active);
  /** The row's target and its chip: the active location first, else the first other location lacking the part. */
  const open = (question: SenderQuestion, ...parts: SenderPart[]) => {
    const lacking = parts.flatMap(part => status.lacking(part)).filter((location, index, all) => all.findIndex(other => other.id === location.id) === index);
    if (!lacking.length || lacking.some(location => location.id === active.id)) return { href: senderHref(question), chip: lacking.length ? { label: "Fehlt", warn: true } : undefined };
    return { href: `${senderHref(question)}?standort=${encodeURIComponent(lacking[0].id)}`, chip: { label: lacking.length === 1 ? `Fehlt für ${lacking[0].name}` : `Fehlt an ${lacking.length} Standorten`, warn: true } };
  };
  const address = open("anschrift", "address"), contact = open("kontakt", "contact"), representative = open("vertretung", "representative"), registerRow = open("register", "registerCourt", "registerNumber");
  const register = [values.legalForm, values.registerNumber, values.vatId].filter(Boolean).join(" · ");
  const saved = (href: string) => Boolean(back?.saved && href.startsWith(back.row));
  return (
    <div id={SENDER_ANCHOR}>
      <Rows title="Absender deiner E-Mails" note={status.complete ? undefined : "Steht als Absender unter jeder Erinnerung und Kampagne an deine Kunden. Solange eine Pflichtangabe fehlt, gehen keine Erinnerungen und Kampagnen raus."}>
        <Row key="address" href={address.href} icon={MapPin} title="Anschrift" saved={saved(senderHref("anschrift"))}
          sub={!status.activeParts.includes("address") ? `${values.street}, ${values.postalCode} ${values.city}` : undefined} chip={address.chip} />
        <Row key="contact" href={contact.href} icon={Phone} title="Kontakt" saved={saved(senderHref("kontakt"))}
          sub={[values.contactEmail, values.contactPhone].filter(Boolean).join(" · ") || undefined} chip={contact.chip} />
        <Row key="representative" href={representative.href} icon={UserRound} title="Vertreten durch" saved={saved(senderHref("vertretung"))}
          sub={values.representative ?? undefined} chip={representative.chip} />
        <Row key="register" href={registerRow.href} icon={Scale} title="Rechtsform und Register" saved={saved(senderHref("register"))} sub={register || "Nur wenn vorhanden"} chip={registerRow.chip} />
      </Rows>
      {status.complete && <div className="ow-tabs-only ow-sender-preview"><FooterPreview sender={values} title="So steht es unter Erinnerungen und Kampagnen" /></div>}
      <div className="ow-toast-region" role="status">{toast && <span className="ow-toast"><Check size={20} aria-hidden="true" />{back?.toast ?? "Gespeichert"}</span>}</div>
    </div>
  );
}
