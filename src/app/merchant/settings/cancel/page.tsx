"use client";

import { CalendarX, Download, Euro } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { postJson } from "@/components/client-api";
import { copyText } from "@/components/copy-text";
import { copyFor } from "@/components/customer/customer-card-copy";
import { setFlash } from "@/components/owner/flash";
import { useOwner } from "@/components/owner/owner-context";
import { Confirm, PageTitle } from "@/components/owner/owner-rows";
import { GuardedLink } from "@/components/owner/owner-shell";
import { ErrorNotice, LoadingBlock, Notice } from "@/components/owner/owner-ui";
import { useLoad } from "@/components/owner/use-load";

const SETTINGS = "/merchant/settings";

type Fact = { label: string; value: string; sub: string };
type View = {
  state: "open" | "cancelled" | "later" | "planned";
  requestedOn: string | null;
  endDate: string;
  endDateText: string;
  facts: { lastDay: Fact; lastInvoice: Fact; exportUntil: Fact };
  reason: string | null;
  locations: string | null;
  customerText: string;
  unit: "Stempel" | "Punkte";
  withdrawal: { text: string };
};
type Failure = { kind: "retry" | "rate" | "ended" | "missing" | "copy"; message: string };

/** The three facts (C1–C8): one white panel, information not warning, the same lines the emails carry. */
function Facts({ facts }: { facts: View["facts"] }) {
  const rows: Array<[LucideIcon, Fact]> = [[CalendarX, facts.lastDay], [Euro, facts.lastInvoice], [Download, facts.exportUntil]];
  return (
    <dl className="ow-qpanel ow-facts">
      {rows.map(([Icon, fact]) => (
        <div key={fact.label} className="ow-fact">
          <Icon size={22} aria-hidden="true" />
          <dt>{fact.label}</dt>
          <dd><strong>{fact.value}</strong>{fact.sub && <span>{fact.sub}</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Desktop (≥1024): what the customers' card shows, from the moment the cancellation is in (C22, C37). */
function CustomerPreview({ view }: { view: View }) {
  const customerCardCopy = copyFor("de");
  const long = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${view.endDate}T00:00:00Z`)).replace(/ /g, "\u00a0"); // the date never breaks after „27.“
  return (
    <aside className="ow-qaside" aria-labelledby="ow-cancel-preview">
      <h2 id="ow-cancel-preview" className="ow-qlabel">So sehen es deine Kunden</h2>
      <div className="ow-qpanel ow-endcard">
        <p><strong>{customerCardCopy.endsOn(long)}</strong></p>
        <p>{customerCardCopy.endsWindow(view.unit === "Punkte")}</p>
      </div>
      <p className="ow-hint">Deine Kunden sehen das Enddatum ab dem Moment, in dem du kündigst.</p>
    </aside>
  );
}

/**
 * „Programm beenden“ (ENG-167, Design's spec of 1 Nov with Legal's answers). A cancellation binds the moment it is sent:
 * the page shows the end it gets and its three facts before, and the recorded end with the customer text after. The owner
 * picks no date; a later end is agreed with the operator. Withdrawing is a question of its own.
 */
export default function CancelProgrammePage() {
  const { me, refresh } = useOwner();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState(false);
  // Design blocking 9: after the binding act, focus lands on the status that confirms it, so a screen reader announces it.
  const focusStatus = useRef(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const programSlug = me?.programSlug;
  const [loaded, reload] = useLoad<View>(programSlug && me?.role === "owner" ? `/api/merchant/program/cancel?programSlug=${encodeURIComponent(programSlug)}` : null);
  const view = loaded.state === "ok" ? loaded.data : null;
  useEffect(() => { if (focusStatus.current && view && view.state !== "open") { focusStatus.current = false; statusRef.current?.focus(); } }, [view]);

  if (!me) return null;
  const head = <PageTitle back={{ href: SETTINGS, label: "Geschäft" }} title="Programm beenden" lead={view?.state === "open" ? "Prüfe die drei Angaben. Wir bestätigen dir das Enddatum per E-Mail." : undefined} />;
  if (me.role !== "owner") return <div className="ow-page ow-qpage">{head}<Notice tone="warn">Die Einstellungen sind Inhaber:innen vorbehalten.</Notice></div>;
  if (loaded.state === "error") return <div className="ow-page ow-qpage">{head}<ErrorNotice message={loaded.message} onRetry={reload} /></div>;
  if (!view) return <div className="ow-page ow-qpage">{head}<LoadingBlock rows={3} /></div>;

  async function send(withdraw: boolean) {
    setSaving(true); setFailure(null);
    try {
      await postJson("/api/merchant/program/cancel", { programSlug, withdraw });
      await refresh();
      if (withdraw) { setFlash("Kündigung zurückgenommen"); router.push(SETTINGS); return; }
      setSaving(false);
      focusStatus.current = true;
      reload();
    } catch (cause) {
      setSaving(false);
      const code = cause && typeof cause === "object" && "code" in cause ? String((cause as { code: unknown }).code) : "";
      // C20/C21: a failed withdrawal leaves the cancellation in force, a failed cancellation leaves the programme running.
      const stays = withdraw ? "Deine Kündigung gilt weiter." : "Dein Programm läuft unverändert weiter.";
      if (code === "PROGRAM_ENDED") { setFailure({ kind: "ended", message: "" }); setAsking(false); }
      else if (code === "NOT_FOUND") { setFailure({ kind: "missing", message: "Dieses Programm haben wir nicht gefunden." }); setAsking(false); }
      else if (code === "RATE_LIMIT") setFailure({ kind: "rate", message: `Zu viele Versuche in kurzer Zeit. ${stays} Versuche es in 15 Minuten noch einmal.` });
      else setFailure({ kind: "retry", message: `Das hat gerade nicht geklappt. ${stays} Versuche es gleich noch einmal.` });
    }
  }
  async function copy() {
    if (await copyText(view!.customerText)) setCopied(true); else setFailure({ kind: "copy", message: "Kopieren nicht möglich. Markiere den Text und kopiere ihn manuell." });
  }
  const failed = failure && (failure.kind === "retry" || failure.kind === "rate") && <Notice tone="danger" role="alert"><strong>Nicht gespeichert</strong> {failure.message}</Notice>;
  // A failed copy saved nothing and lost nothing: its own line, not „Nicht gespeichert“.
  const copyFailed = failure?.kind === "copy" && <Notice tone="warn" role="alert">{failure.message}</Notice>;

  // A final refusal replaces the page with no retry line: an ended programme goes to its ended page, a missing one stands alone.
  if (failure?.kind === "ended") { router.replace("/merchant"); return null; }
  if (failure?.kind === "missing") return <div className="ow-page ow-qpage">{head}<Notice tone="danger" role="alert">{failure.message}</Notice></div>;

  // O6: withdrawing is a question of its own, and helps the shop, so it is the green action.
  if (asking) return (
    <Confirm title="Kündigung zurücknehmen?" back="Programm beenden" action="Zurücknehmen" busyAction="Wird gespeichert …" busy={saving} danger={false} onConfirm={() => void send(true)} onCancel={() => { setAsking(false); setFailure(null); }}>
      <div className="ow-qpanel"><p>{view.withdrawal.text}</p></div>
      {failed}
    </Confirm>
  );

  if (view.state !== "open") return (
    <div className="ow-page ow-qpage">
      {head}
      <div className="ow-qend">
        <div className="ow-q">
          {/* Design: a check in the warn tint; an end is a fact to plan for, not a success. */}
          <div ref={statusRef} tabIndex={-1} className="ow-qstatus">
            <Notice tone="warn" role="status" icon="check">
              {view.state === "planned"
                ? <><strong>Dein Programm endet am {view.endDateText}.</strong> So haben wir es mit dir vereinbart. Bis dahin läuft alles normal.</>
                : <><strong>{view.state === "later" ? `Neues Enddatum: ${view.endDateText}` : `Gekündigt am ${view.requestedOn}`}</strong>
                  {view.state === "later"
                    ? " So haben wir es mit dir vereinbart. Die Bestätigung haben wir dir per E-Mail geschickt. Bis dahin läuft alles normal."
                    : ` Deine Kündigung ist bei uns eingegangen. Dein Programm endet am ${view.endDateText}. Die Bestätigung haben wir dir per E-Mail geschickt. Bis dahin läuft alles normal.`}</>}
            </Notice>
          </div>
          <Facts facts={view.facts} />
          {view.locations && <p className="ow-qnote">{view.locations}</p>}
          <div className="ow-qpanel ow-field">
            <label htmlFor="ow-cancel-text">Text für deine Kunden</label>
            <textarea id="ow-cancel-text" className="ow-textarea" readOnly rows={4} value={view.customerText} aria-describedby="ow-cancel-hint" onFocus={event => event.currentTarget.select()} />
            <p id="ow-cancel-hint" className="ow-hint">Diesen Text kannst du an der Kasse aushängen oder an deine Kunden schicken. Wir schicken nichts an deine Kunden.</p>
            <div><button type="button" className="ow-btn ow-btn--primary" onClick={() => void copy()}>{copied ? "Text kopiert" : "Text kopieren"}</button></div>
          </div>
          {failed}{copyFailed}
          {/* A planned end was agreed with the operator; the owner did not cancel, so there is nothing to take back here. */}
          {view.state !== "planned" && <button type="button" className="ow-qlink" disabled={saving} onClick={() => { setFailure(null); setAsking(true); }}>Kündigung zurücknehmen</button>}
        </div>
        <CustomerPreview view={view} />
      </div>
    </div>
  );

  // O1 (earliest end), O2 (late notice: names the missed cutoff), O3 (free month), O9 (every location ends together).
  return (
    <div className="ow-page ow-qpage">
      {head}
      <div className="ow-qend">
        <div className="ow-q">
          <Facts facts={view.facts} />
          {view.reason && <p className="ow-qnote">{view.reason}</p>}
          {view.locations && <p className="ow-qnote">{view.locations}</p>}
          {failed}
          <div className="ow-qsave ow-qsave--pair">
            <button type="button" className="ow-btn ow-btn--danger" disabled={saving} aria-busy={saving} onClick={() => void send(false)}>
              {saving ? "Wird gespeichert …" : "Ja, Programm beenden"}
            </button>
            <GuardedLink href={SETTINGS} className="ow-btn ow-btn--secondary">Abbrechen</GuardedLink>
          </div>
        </div>
        <CustomerPreview view={view} />
      </div>
    </div>
  );
}
