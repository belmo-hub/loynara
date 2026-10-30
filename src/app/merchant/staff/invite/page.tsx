"use client";

import { ScanLine, Users } from "lucide-react";
import { useRef, useState } from "react";
import { postJson } from "@/components/client-api";
import { CopyLabel, useCopy } from "@/components/copy-text";
import { useDirtyGuard, useOwner } from "@/components/owner/owner-context";
import { inviteCreateMessage } from "@/components/owner/owner-errors";
import { PageTitle } from "@/components/owner/owner-rows";
import { ErrorNotice, Notice } from "@/components/owner/owner-ui";
import { Choices, FieldError } from "@/components/owner/question-form";
import { ROLE_HINT } from "@/components/owner/staff-data";
import { useLoad } from "@/components/owner/use-load";
import { useFormCheck } from "@/components/ui/form-check";

type InviteResult = { id: string; token: string; expiresAt: string; email: string; role: "manager" | "cashier" };
const BACK = { href: "/merchant/staff", label: "Team" };
const ROLES = [{ value: "cashier", label: "Kasse", sub: ROLE_HINT.cashier, icon: ScanLine }, { value: "manager", label: "Leitung", sub: ROLE_HINT.manager, icon: Users }];

/** „Person einladen“ (ENG-122c, screen 16) as one question; the link shows once on this page afterwards and is never sent. */
export default function InvitePage() {
  const { me } = useOwner();
  const owner = me?.role === "owner";
  const [staff] = useLoad<{ accountCreation?: "public" | "invite" | "operator" }>(owner ? "/api/staff" : null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"manager" | "cashier">("cashier");
  const draftRevision = useRef(0);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const fields = useFormCheck();
  const { copied, copy: copyLink } = useCopy();
  useDirtyGuard("staff-invite", email.trim().length > 0);
  if (!me) return null;
  // Heading and note: copy-rest R16 FINAL.
  const head = <PageTitle back={BACK} title="Wen lädst du ein?" lead={`Zugriff gilt für ${me.locationName}.`} />;
  if (!owner) return <div className="ow-page">{head}<Notice tone="warn" role="alert">Nur Inhaber:innen können Teamzugänge verwalten.</Notice></div>;
  const inviteUrl = invite && me.publicBaseUrl ? new URL(`/invite/${encodeURIComponent(invite.token)}`, me.publicBaseUrl).toString() : "";

  async function create() {
    if (!me?.locationId || busy) return;
    const submitted = { email: email.trim(), role, revision: draftRevision.current };
    setBusy(true); setError(""); setMessage(""); setInvite(null);
    try {
      setInvite(await postJson<InviteResult>("/api/staff/invite", { locationId: me.locationId, email: submitted.email, role: submitted.role }));
      if (draftRevision.current === submitted.revision) setEmail("");
    } catch (cause) { setError(inviteCreateMessage(cause, submitted.email)); }
    finally { setBusy(false); }
  }
  async function copy() {
    if (await copyLink(inviteUrl)) { setMessage("Link kopiert. Er wurde nicht versendet."); setError(""); }
    else setError("Kopieren nicht möglich. Bitte markiere den Link manuell.");
  }

  return (
    <div className="ow-page ow-qpage">
      {head}
      <form className="ow-q" noValidate onInput={fields.onInput} onSubmit={event => { event.preventDefault(); if (fields.check(event.currentTarget)) void create(); }}>
        <div className="ow-qpanel ow-field"><label htmlFor="st-email">E-Mail-Adresse</label><input id="st-email" {...fields.aria("st-email")} className="ow-input" type="email" value={email} onChange={event => { draftRevision.current++; setEmail(event.target.value); }} autoComplete="email" required placeholder="team@geschaeft.de" /><FieldError id="st-email-error">{fields.error("st-email") ?? ""}</FieldError></div>
        <h2 className="ow-qlabel">Rolle</h2>
        <Choices name="st-role" label="Rolle" options={ROLES} value={role} saved={role} onChange={value => { draftRevision.current++; setRole(value as "manager" | "cashier"); }} />
        <p className="ow-hint ow-qnote">Der Link wird nicht versendet. Du gibst ihn der Person selbst.</p>
        {error && <ErrorNotice message={error} />}
        {invite && (
          <div className="ow-qpanel ow-stack" role="status"><strong>Einladung für {invite.email}</strong>
            <p>Dieser Link gilt bis {new Date(invite.expiresAt).toLocaleDateString("de-DE")}. Teile ihn nur mit der eingeladenen Person.</p>
            {staff.state === "ok" && <p className="ow-hint">{staff.data.accountCreation === "operator" ? "Konten werden derzeit vom Loynara-Betreiber angelegt. Die Person nimmt die Einladung an, sobald ihr Konto für genau diese Adresse besteht." : staff.data.accountCreation === "invite" ? "Die Person legt über den Link ihr eigenes Konto für genau diese Adresse an und ist danach sofort an der Kasse." : "Die Person kann über den Link ein Konto erstellen und die Einladung annehmen."}</p>}
            <code style={{ overflowWrap: "anywhere", fontSize: "var(--text-14)" }}>{inviteUrl}</code>
            <div><button type="button" className="ow-btn ow-btn--secondary ow-btn--sm" onClick={() => void copy()}><CopyLabel copied={copied} label="Link kopieren" /></button></div>
            {message && <p className="ow-hint">{message}</p>}
          </div>
        )}
        <div className="ow-qsave"><button type="submit" className="ow-btn ow-btn--primary" disabled={busy} aria-busy={busy}>Einladungslink erstellen</button></div>
      </form>
    </div>
  );
}
