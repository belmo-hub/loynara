"use client";

import { useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { addressProblems, contactProblems, LOCATION_PARTS, missingParts, missingSentence, MISSING_TITLE, LEGAL_FORMS, normalizeRegisterNumber, normalizeVatId, registeredForm, registerProblems,
  representativeProblems, footerPreview, type PreviewPiece, type SenderDetails, type SenderPart } from "@/lib/sender-details";
import { useOwner, type OwnerLocation } from "./owner-context";
import type { MeResponse } from "@/components/client-api";
import { PageTitle } from "./owner-rows";
import { GuardedLink } from "./owner-shell";
import { Notice } from "./owner-ui";
import { FieldError, QuestionForm, useQuestion, type QuestionHome } from "./question-form";
import { senderHref, type SenderQuestion } from "./sender-routes";

/* Geschäft › Absender deiner E-Mails (ENG-164, Design 1 Nov): four rows, a one-question screen each, Legal's footer as
   the owner's proof, and a box wherever an email send starts while a required part is missing. */

export const SENDER_LIST = "owner-geschaeft-return";
export const SENDER_HOME: QuestionHome = { href: "/merchant/settings", label: "Geschäft", list: SENDER_LIST };
export const SENDER_ANCHOR = "absender";
/** The row titles on Geschäft. */
const SENDER_TITLES: Record<SenderQuestion, string> = { anschrift: "Anschrift", kontakt: "Kontakt", vertretung: "Vertreten durch", register: "Rechtsform und Register" };

/** Email sends exist where campaigns or automations are offered; elsewhere the sender section and its screens are withheld. */
export const senderOffered = (hidden: readonly string[]) => !hidden.includes("campaigns") || !hidden.includes("automations");

export const senderOf = (me: Pick<MeResponse, "businessName">, location: OwnerLocation): SenderDetails => ({
  shopName: me.businessName, street: location.street, postalCode: location.postalCode, city: location.city, representative: location.representative,
  contactEmail: location.contactEmail, contactPhone: location.contactPhone, legalForm: location.legalForm, registerCourt: location.registerCourt,
  registerNumber: location.registerNumber, vatId: location.vatId,
});

/** What each location still lacks; the active one first. */
export function senderStatus(me: MeResponse, locations: OwnerLocation[]) {
  const active = locations.find(location => location.id === me.locationId) ?? null;
  const rows = locations.map(location => ({ location, parts: missingParts(senderOf(me, location)) }));
  const activeParts = active ? missingParts(senderOf(me, active)) : (["address", "contact", "representative"] as SenderPart[]);
  const lacking = (part: SenderPart) => rows.filter(row => row.parts.includes(part)).map(row => row.location);
  return { active, activeParts, complete: rows.every(row => row.parts.length === 0) && activeParts.length === 0, lacking, many: locations.length > 1 };
}

/** Legal's footer as the mail prints it, with the unsubscribe link and privacy page as placeholders; `marks` tints the register and VAT lines. */
export function FooterPreview({ sender, title, marks = false, bare = false }: { sender: SenderDetails; title: string; marks?: boolean; /** Inside the composer's mail preview: no panel of its own. */ bare?: boolean }) {
  // The privacy page on this app's host (PUBLIC_BASE_URL, via /api/me), as the mail prints it; never a hard-coded host.
  const base = useOwner().me?.publicBaseUrl;
  const privacy = base ? (({ host, pathname }) => `${host}${pathname}`)(new URL("/datenschutz", base)) : "/datenschutz";
  const footer = footerPreview(sender);
  const pieces = (list: readonly PreviewPiece[]) => list.map((piece, index) => piece.missing ? <span key={index} className="ow-preview-missing">{piece.text}</span> : piece.text);
  const mark = (content: ReactNode) => content && <>{" "}{marks ? <mark className="ow-preview-mark">{content}</mark> : content}</>;
  const incomplete = [...footer.identity, ...(footer.register ?? [])].some(piece => piece.missing);
  const body = <>
    {incomplete && <p className="ow-preview-note">Noch nicht vollständig. Sobald du das Fehlende einträgst, steht es so unter jeder Erinnerung und Kampagne.</p>}
    <p>{pieces(footer.identity)}{mark(footer.register && pieces(footer.register))}{mark(footer.vat)}</p>
    <p className="ow-preview-tail">{footer.consent} Abmelden: Link · Datenschutz: {privacy}</p>
  </>;
  return bare ? <div className="ow-preview ow-preview--bare" aria-label={title}>{body}</div> : <section className="ow-preview" aria-label={title}><h2>{title}</h2>{body}</section>;
}

/**
 * Above a composer or an automation switch while the active location or the business lacks a required part (A10, A10b).
 * Returns null when nothing is missing. One missing address of a shop with several locations opens that screen and comes
 * back to `returnTo`; otherwise the button leads to Geschäft's section.
 */
export function SenderMissingBox({ returnTo }: { returnTo: string }) {
  const { me, locations } = useOwner();
  if (!me) return null;
  const status = senderStatus(me, locations);
  if (!status.activeParts.length) return null;
  const location = status.many && status.activeParts.some(part => LOCATION_PARTS.includes(part)) ? status.active?.name : undefined;
  const onlyAddress = status.activeParts.length === 1 && status.activeParts[0] === "address" && status.many;
  const href = onlyAddress && status.active ? `${senderHref("anschrift")}?standort=${encodeURIComponent(status.active.id)}&zurueck=${encodeURIComponent(returnTo)}` : `${SENDER_HOME.href}#${SENDER_ANCHOR}`;
  return (
    <Notice tone="warn" actions={<GuardedLink className="ow-btn ow-btn--primary ow-btn--sm" href={href}>{onlyAddress ? "Anschrift eintragen" : "Absender eintragen"}</GuardedLink>}>
      <strong>{MISSING_TITLE}</strong> {missingSentence(status.activeParts, location)}
    </Notice>
  );
}

/** True while the active location or the business lacks a required part: sends wait (A10). */
export function useSenderMissing() {
  const { me, locations } = useOwner();
  return me ? senderStatus(me, locations).activeParts.length > 0 : true;
}

// ---- The four screens (A03, A05, A07, A08; A15b with ?standort=) ----

const Field = ({ id, label, error, children }: { id: string; label: string; error: string; children: ReactNode }) => (
  <div className="ow-qpanel ow-field"><label htmlFor={id}>{label}</label>{children}<FieldError id={`${id}-error`}>{error}</FieldError></div>
);
const aria = (id: string, error: string) => error ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {};

/** `?zurueck=` is a path inside the owner area only; anything else goes back to Geschäft. */
const returnPath = (value: string | null) => value && /^\/merchant\/[\w/-]*$/.test(value) ? value : null;

export function SenderQuestionPage({ question }: { question: SenderQuestion }) {
  const { me, locations } = useOwner();
  const params = useSearchParams();
  if (!me) return null;
  // Opened by URL as a manager: the owner-only head and notice (DESIGN C-R8), not an empty page.
  if (me.role !== "owner") return <div className="ow-page ow-qpage"><PageTitle back={{ href: SENDER_HOME.href, label: SENDER_HOME.label }} title={SENDER_TITLES[question]} /><Notice>Nur die Inhaberin oder der Inhaber kann den Absender ändern.</Notice></div>;
  const active = locations.find(location => location.id === me.locationId);
  const scoped = locations.find(location => location.id === params.get("standort"));
  const location = scoped ?? active;
  if (!location || !active) return null;
  const back = returnPath(params.get("zurueck"));
  // A return to where the owner came from, or a location other than the active one, says so on the back link (E45).
  const home: QuestionHome = back ? { href: back, label: "Zurück", list: SENDER_LIST } : location.id !== active.id ? { ...SENDER_HOME, label: "Zurück" } : SENDER_HOME;
  const props = { me, location, active, home };
  return question === "anschrift" ? <AddressQuestion {...props} /> : question === "kontakt" ? <ContactQuestion {...props} />
    : question === "vertretung" ? <RepresentativeQuestion {...props} /> : <RegisterQuestion {...props} />;
}

type QuestionProps = { me: MeResponse; location: OwnerLocation; active: OwnerLocation; home: QuestionHome };
const where = (location: OwnerLocation, active: OwnerLocation) => location.id === active.id
  ? `Gilt für den Standort ${location.name}. Jeder Standort hat seine eigene Anschrift.`
  : `Gilt für den Standort ${location.name}. Dein aktiver Standort bleibt ${active.name}.`;

function AddressQuestion({ location, active, home }: QuestionProps) {
  const initial = { street: location.street ?? "", postalCode: location.postalCode ?? "", city: location.city };
  const [draft, setDraft] = useState(initial);
  const problems = addressProblems(draft);
  const ids = { "sd-street": problems.street, "sd-postal": problems.postalCode, "sd-city": problems.city };
  const q = useQuestion("sender-address", JSON.stringify(draft) !== JSON.stringify(initial), ids, home);
  const set = (patch: Partial<typeof draft>) => setDraft(current => ({ ...current, ...patch }));
  return (
    <QuestionForm title={location.id === active.id ? "Wo ist dein Geschäft?" : `Wo ist dein Geschäft in ${location.name}?`} lead="Steht als Absender unter jeder Erinnerung und Kampagne an deine Kunden." home={home}
      busy={q.busy} failed={q.failed} onSubmit={() => void q.save("/api/merchant/sender", { part: "address", locationId: location.id, ...draft })}>
      <Field id="sd-street" label="Straße und Hausnummer" error={q.error("sd-street")}>
        <input id="sd-street" className="ow-input" autoComplete="street-address" placeholder="z. B. Hauptstraße 12" value={draft.street} {...aria("sd-street", q.error("sd-street"))} onChange={event => set({ street: event.target.value })} />
      </Field>
      <div className="ow-qpanel ow-qpair">
        <div className="ow-field"><label htmlFor="sd-postal">PLZ</label>
          <input id="sd-postal" className="ow-input" inputMode="numeric" autoComplete="postal-code" maxLength={5} value={draft.postalCode} {...aria("sd-postal", q.error("sd-postal"))} onChange={event => set({ postalCode: event.target.value })} /></div>
        <div className="ow-field"><label htmlFor="sd-city">Stadt</label>
          <input id="sd-city" className="ow-input" autoComplete="address-level2" value={draft.city} {...aria("sd-city", q.error("sd-city"))} onChange={event => set({ city: event.target.value })} /></div>
        <FieldError id="sd-postal-error">{q.error("sd-postal")}</FieldError>
        <FieldError id="sd-city-error">{q.error("sd-city")}</FieldError>
      </div>
      <p className="ow-hint">{where(location, active)}</p>
    </QuestionForm>
  );
}

function ContactQuestion({ location, active, home }: QuestionProps) {
  const initial = { contactEmail: location.contactEmail ?? "", contactPhone: location.contactPhone ?? "" };
  const [draft, setDraft] = useState(initial);
  const problems = contactProblems(draft);
  const ids = { "sd-email": problems.contactEmail, "sd-phone": problems.contactPhone };
  const q = useQuestion("sender-contact", JSON.stringify(draft) !== JSON.stringify(initial), ids, home);
  const set = (patch: Partial<typeof draft>) => setDraft(current => ({ ...current, ...patch }));
  return (
    <QuestionForm title="Wie erreichen dich deine Kunden?" home={home} busy={q.busy} failed={q.failed}
      onSubmit={() => void q.save("/api/merchant/sender", { part: "contact", locationId: location.id, ...draft })}>
      <div className="ow-qpanel ow-stack">
        <div className="ow-field"><label htmlFor="sd-email">E-Mail</label>
          <input id="sd-email" className="ow-input" type="email" inputMode="email" autoComplete="email" value={draft.contactEmail} {...aria("sd-email", q.error("sd-email"))} onChange={event => set({ contactEmail: event.target.value })} />
          <FieldError id="sd-email-error">{q.error("sd-email")}</FieldError></div>
        <div className="ow-field"><label htmlFor="sd-phone">Telefon (optional)</label>
          <input id="sd-phone" className="ow-input" type="tel" inputMode="tel" autoComplete="tel" placeholder="z. B. 0561 739 2214" value={draft.contactPhone} {...aria("sd-phone", q.error("sd-phone"))} onChange={event => set({ contactPhone: event.target.value })} />
          <FieldError id="sd-phone-error">{q.error("sd-phone")}</FieldError></div>
        <p className="ow-hint">Was du einträgst, steht nach „Kontakt:“ unter jeder Erinnerung und Kampagne.</p>
        {/* Opened from „Fehlt für {Standort}“ (A15): name the location this edits, as Anschrift does. */}
        {location.id !== active.id && <p className="ow-hint">{where(location, active)}</p>}
      </div>
    </QuestionForm>
  );
}

function RepresentativeQuestion({ location, home }: QuestionProps) {
  const initial = location.representative ?? "";
  const [draft, setDraft] = useState(initial);
  const ids = { "sd-representative": representativeProblems({ representative: draft }).representative };
  const q = useQuestion("sender-representative", draft !== initial, ids, home);
  return (
    <QuestionForm title="Wer vertritt dein Geschäft?" home={home} busy={q.busy} failed={q.failed}
      onSubmit={() => void q.save("/api/merchant/sender", { part: "representative", representative: draft })}>
      <Field id="sd-representative" label="Inhaber:in oder Geschäftsführer:in" error={q.error("sd-representative")}>
        <input id="sd-representative" className="ow-input" autoComplete="name" value={draft} {...aria("sd-representative", q.error("sd-representative"))} onChange={event => setDraft(event.target.value)} />
      </Field>
      <p className="ow-hint">Gilt für alle deine Standorte.</p>
    </QuestionForm>
  );
}

function RegisterQuestion({ me, location, home }: QuestionProps) {
  const initial = { legalForm: location.legalForm ?? "", registerCourt: location.registerCourt ?? "", registerNumber: location.registerNumber ?? "", vatId: location.vatId ?? "" };
  const [draft, setDraft] = useState(initial);
  // A stored form that is not one of the choices is „Andere …“ with its own text (A08).
  const [other, setOther] = useState(() => Boolean(initial.legalForm) && !LEGAL_FORMS.some(form => form.value === initial.legalForm));
  const problems = registerProblems(draft);
  const ids = { "sd-legal-form": problems.legalForm, "sd-court": problems.registerCourt, "sd-number": problems.registerNumber, "sd-vat": problems.vatId };
  const q = useQuestion("sender-register", JSON.stringify(draft) !== JSON.stringify(initial), ids, home);
  const set = (patch: Partial<typeof draft>) => setDraft(current => ({ ...current, ...patch }));
  // Court and number say „(optional)“ unless the chosen form is a registered one (E52); the VAT ID always does (E53).
  const optional = registeredForm(draft.legalForm) ? "" : " (optional)";
  // The preview shows what would print, normalised as the owner types; a line whose field is wrong is left out (A09).
  const registerOk = !problems.registerCourt && !problems.registerNumber;
  const preview: SenderDetails = { ...senderOf(me, location),
    legalForm: !problems.legalForm && draft.legalForm.trim() || null,
    registerCourt: registerOk && draft.registerCourt.trim() || null, registerNumber: registerOk && normalizeRegisterNumber(draft.registerNumber) || null,
    vatId: !problems.vatId && normalizeVatId(draft.vatId) || null };
  const field = (id: string, label: string, key: keyof typeof draft, placeholder: string, extra: object = {}) => (
    <Field id={id} label={label} error={q.error(id)}>
      <input id={id} className="ow-input" placeholder={placeholder} value={draft[key]} {...extra} {...aria(id, q.error(id))} onChange={event => set({ [key]: event.target.value })} />
    </Field>
  );
  return (
    <QuestionForm title="Rechtsform, Register und USt-IdNr." lead="Bei eingetragenen Rechtsformen wie GmbH, UG, e.K., KG oder eGbR sind Registergericht und Registernummer Pflicht. Alles andere nur, wenn vorhanden. Leere Felder erscheinen nicht in der E-Mail." home={home}
      aside={<FooterPreview sender={preview} title="So steht es in der E-Mail" marks />} busy={q.busy} failed={q.failed}
      onSubmit={() => void q.save("/api/merchant/sender", { part: "register", ...draft })}>
      <div className="ow-qpanel ow-field"><label htmlFor="sd-form">Rechtsform</label>
        <select id="sd-form" className="ow-select" value={other ? "other" : draft.legalForm} onChange={event => {
          const value = event.target.value;
          setOther(value === "other");
          set({ legalForm: value === "other" ? "" : value });
        }}>
          {LEGAL_FORMS.map(form => <option key={form.value} value={form.value}>{form.label}</option>)}
          <option value="other">Andere …</option>
        </select>
        {other && <div className="ow-field ow-mt-3"><label htmlFor="sd-legal-form">Deine Rechtsform</label>
          <input id="sd-legal-form" className="ow-input" value={draft.legalForm} {...aria("sd-legal-form", q.error("sd-legal-form"))} onChange={event => set({ legalForm: event.target.value })} />
          <FieldError id="sd-legal-form-error">{q.error("sd-legal-form")}</FieldError></div>}
      </div>
      {field("sd-court", `Registergericht${optional}`, "registerCourt", "z. B. Amtsgericht Kassel")}
      {field("sd-number", `Registernummer${optional}`, "registerNumber", "z. B. HRB 12345")}
      {field("sd-vat", "USt-IdNr. (optional)", "vatId", "z. B. DE123456789", { autoCapitalize: "characters" })}
    </QuestionForm>
  );
}
