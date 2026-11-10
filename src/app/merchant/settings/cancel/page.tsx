"use client";

import { CalendarClock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { postJson } from "@/components/client-api";
import { copyText } from "@/components/copy-text";
import { useOwner } from "@/components/owner/owner-context";
import { PageTitle } from "@/components/owner/owner-rows";
import { GuardedLink } from "@/components/owner/owner-shell";
import { Notice } from "@/components/owner/owner-ui";
import { cancellationEnd, MIN_NOTICE_DAYS } from "@/lib/programme-end-date";
import { germanDate } from "@/lib/german-date";

const SETTINGS = "/merchant/settings";

/**
 * „Programm beenden“ behind its link on Geschäft (ENG-122c): the live flow and wording, the confirmation a screen of its own
 * (Programm 28/30), back on Geschäft after either answer. Cancelling records an end date only; nothing is sent to customers
 * and nothing is deleted. Redemptions work until then.
 */
export default function CancelProgrammePage() {
  const { me, refresh } = useOwner();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  // A failed save sits behind the two pinned buttons on a phone: bring it into view, as question-form.tsx does.
  const fail = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) fail.current?.scrollIntoView({ block: "nearest" }); }, [error]);
  if (!me) return null;
  const head = <PageTitle back={{ href: SETTINGS, label: "Geschäft" }} title="Programm beenden" />;
  if (me.role !== "owner") return <div className="ow-page ow-qpage">{head}<Notice>Die Einstellungen sind Inhaber:innen vorbehalten.</Notice></div>;
  const programSlug = me.programSlug;
  const endDate = me.cancellationEndDate ?? null;
  const confirmed = me.cancellationConfirmed === true;
  // Stamp shops hear about Stempel, points shops about Punkte (ENG-133, audit I-28).
  const unit = me.programType === "stamp" ? "Stempel" : "Punkte";
  const text = endDate ? `Unsere ${unit}karte läuft noch bis einschließlich ${germanDate(endDate)}. Bis dahin kannst du weiter sammeln und Prämien einlösen. Danach geht das nicht mehr.` : "";
  async function send(withdraw: boolean) {
    setSaving(true); setError("");
    try { await postJson("/api/merchant/program/cancel", { programSlug, withdraw }); await refresh(); router.push(SETTINGS); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen."); setSaving(false); }
  }
  async function copy() {
    if (await copyText(text)) setCopied(true); else setError("Kopieren nicht möglich. Markiere den Text und kopiere ihn manuell.");
  }
  const failed = error && <div ref={fail} className="ow-qfail"><Notice tone="danger">{error}</Notice></div>;

  if (endDate) return (
    <div className="ow-page ow-qpage">
      {head}
      <div className="ow-q">
        {confirmed
          ? <Notice tone="warn">Dein Programm endet am {germanDate(endDate)}. Bis dahin läuft alles normal, auch das Einlösen von Prämien.</Notice>
          : <Notice tone="warn">Voraussichtlich bis zum {germanDate(endDate)}. Laut Pilotvereinbarung endet der Vertrag mit {MIN_NOTICE_DAYS} Tagen Frist zum Ende eines Abrechnungsmonats. Wir bestätigen dir das genaue Enddatum per E-Mail. Bis dahin läuft alles normal.</Notice>}
        {confirmed && <div className="ow-qpanel ow-field">
          <label htmlFor="ow-cancel-text">Text für deine Kunden</label>
          <textarea id="ow-cancel-text" className="ow-textarea" readOnly rows={4} value={text} aria-describedby="ow-cancel-hint" onFocus={event => event.currentTarget.select()} />
          <p id="ow-cancel-hint" className="ow-hint">Diesen Text kannst du an der Kasse aushängen oder an deine Kunden schicken. Wir schicken nichts an deine Kunden.</p>
          <div><button type="button" className="ow-btn ow-btn--secondary" onClick={() => void copy()}>{copied ? "Text kopiert" : "Text kopieren"}</button></div>
        </div>}
        {failed}
        <button type="button" className="ow-qlink" disabled={saving} onClick={() => void send(true)}>Kündigung zurücknehmen</button>
      </div>
    </div>
  );

  const planned = cancellationEnd(new Date());
  return (
    <div className="ow-page ow-qpage">
      {head}
      <div className="ow-q">
        <div className="ow-qpanel ow-qwhen">
          <CalendarClock size={24} aria-hidden="true" />
          <p><strong>Voraussichtlich bis zum {germanDate(planned.endDate)}.</strong> Wir bestätigen dir das genaue Enddatum per E-Mail.{planned.nextMonth ? ` Weil bis zum Monatsende weniger als ${MIN_NOTICE_DAYS} Tage bleiben, rechnen wir mit dem Ende des Folgemonats.` : ""}</p>
        </div>
        <div className="ow-qpanel"><p>Bis zum Enddatum läuft alles normal. Deine Kunden sammeln weiter {unit} und lösen Prämien ein, danach nicht mehr. Die {unit} bleiben gespeichert.</p></div>
        {failed}
        <div className="ow-qsave ow-qsave--pair">
          <button type="button" className="ow-btn ow-btn--danger" disabled={saving} aria-busy={saving} onClick={() => void send(false)}>Ja, Programm beenden</button>
          <GuardedLink href={SETTINGS} className="ow-btn ow-btn--secondary">Abbrechen</GuardedLink>
        </div>
      </div>
    </div>
  );
}
