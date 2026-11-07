"use client";

import { Plus, Users } from "lucide-react";
import { useState } from "react";
import { postJson } from "@/components/client-api";
import { useOwner } from "@/components/owner/owner-context";
import { Band, Confirm, PageTitle, Row, Rows } from "@/components/owner/owner-rows";
import { ErrorNotice, LoadingBlock, nf, Notice, NumberStepper } from "@/components/owner/owner-ui";
import { Control, QuestionForm, rangeError, SwitchRow, useReview, wholeIn } from "@/components/owner/question-form";
import { useLoad } from "@/components/owner/use-load";
import { EmptyState } from "@/components/ui/empty-state";

type Settings = { enabled: boolean; referrerBonus: number; referredBonus: number; programType: "stamp" | "points" };
type Referral = { id: string; status: string; referrerCard: string; referredCard: string; referrerBonus: number; referredBonus: number; reviewReason: string | null; hasCreditedBonus: boolean; createdAt: string; qualifiedAt: string | null };
type Bonus = "referrerBonus" | "referredBonus";

const STATUS: Record<string, string> = { pending: "Wartet auf erste Buchung", qualified: "Bonus gebucht", review: "Prüfung nötig", rejected: "Abgelehnt", reversed: "Bonus korrigiert" };
const status = (value: string) => STATUS[value] ?? value;
function reviewReason(value: string | null) {
  switch (value) {
    case "duplicate_verified_email": return "Eine andere Karte mit derselben verifizierten E-Mail-Adresse hat bereits einen Empfehlungsbonus ausgelöst.";
    case "same_verified_email": return "Beide Karten haben dieselbe verifizierte E-Mail-Adresse.";
    case "bonus_spent": return "Ein Bonus wurde bereits eingelöst oder ausgegeben.";
    case "owner_required": return "Die Korrektur überschreitet die Befugnis der Standortleitung.";
    case "member_unavailable": return "Eine der Karten ist nicht mehr verfügbar.";
    case "balance_limit": return "Ein Guthabenlimit würde überschritten.";
    default: return value ?? "";
  }
}
/** The two bonus rows and their questions: copy-rest R18 FINAL. */
const BONUS: Record<Bonus, string> = { referrerBonus: "Bonus für die empfehlende Karte", referredBonus: "Bonus für die neue Karte" };
const SAVED = "Empfehlungsregel gespeichert. Änderungen gelten für neue Anmeldungen mit Empfehlungslink.";
const ONE_BONUS = "Bei aktiver Regel muss ein Bonus größer als null sein.";
const BACK = { href: "/merchant/program", label: "Programm" };

export default function MerchantReferralsPage() {
  const { me } = useOwner();
  const slug = me?.programSlug ? encodeURIComponent(me.programSlug) : null;
  const owner = me?.role === "owner";
  const [rule, reloadRule] = useLoad<Settings>(owner && slug ? `/api/merchant/referrals/settings?programSlug=${slug}` : null);
  const [list, reloadList] = useLoad<{ referrals: Referral[] }>(owner && slug ? `/api/merchant/referrals?programSlug=${slug}` : null);
  if (!me) return null;
  const head = <PageTitle back={BACK} title="Empfehlungen" lead="Geteilt ist noch nicht gewonnen: Ein Bonus fließt erst, wenn die neue Karte zum ersten Mal an deiner Kasse bestätigt wird." />;
  if (!owner) return <div className="ow-page">{head}<Notice tone="warn" role="alert">Nur die Inhaberin oder der Inhaber kann Empfehlungen verwalten.</Notice></div>;
  if (rule.state === "error") return <div className="ow-page">{head}<ErrorNotice message={rule.message} onRetry={reloadRule} /></div>;
  if (rule.state !== "ok") return <div className="ow-page">{head}<LoadingBlock rows={2} height={64} /></div>;
  return <Loaded slug={me.programSlug} head={head} settings={rule.data} list={list} reloadList={reloadList} />;
}

/**
 * Empfehlungen (ENG-122c, screen 18): the review count as the band, the rule switch and the two bonus rows (each a question
 * with its own save), the last 100 as rows with a „Prüfung nötig“ chip; a review opens as a step of this page.
 */
function Loaded({ slug, head, settings, list, reloadList }: { slug: string; head: React.ReactNode; settings: Settings; list: ReturnType<typeof useLoad<{ referrals: Referral[] }>>[0]; reloadList: () => void }) {
  const [saved, setSaved] = useState(settings);
  const [switching, setSwitching] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"ok" | "warn">("ok");
  const [error, setError] = useState("");
  const step = useReview<string>();
  const unit = saved.programType === "points" ? { one: "Punkt", many: "Punkte" } : { one: "Stempel", many: "Stempel" };

  async function post(next: Settings) {
    const result = await postJson<Settings>("/api/merchant/referrals/settings", { programSlug: slug, enabled: next.enabled, referrerBonus: next.referrerBonus, referredBonus: next.referredBonus });
    setSaved(result); setNotice(SAVED); setNoticeTone("ok");
  }
  async function toggle(enabled: boolean) {
    setNotice(""); setError("");
    if (enabled && saved.referrerBonus === 0 && saved.referredBonus === 0) { setError(ONE_BONUS); return; }
    setSwitching(true);
    try { await post({ ...saved, enabled }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Die Regel konnte nicht gespeichert werden."); }
    finally { setSwitching(false); }
  }

  const referrals = list.state === "ok" ? list.data.referrals : [];
  const reviews = referrals.filter(item => item.status === "review");
  const open = (next: string) => { setNotice(""); setError(""); step.open(next); };
  if (step.step === "referrerBonus" || step.step === "referredBonus") {
    const which = step.step;
    return <BonusQuestion which={which} saved={saved} unit={unit} onBack={step.back} save={async value => { await post({ ...saved, [which]: value }); step.leave(which); }} />;
  }
  const reviewing = referrals.find(item => `review:${item.id}` === step.step);
  if (reviewing) return <ReviewStep referral={reviewing} onBack={step.back} onDone={(message, tone) => { reloadList(); setNotice(message); setNoticeTone(tone); step.leave(`review:${reviewing.id}`); }} />;

  // Off and nothing happened yet: an empty history only pushes the switch down the page.
  const untouched = !saved.enabled && list.state === "ok" && referrals.length === 0;
  return (
    <div className="ow-page">
      {head}
      {notice && <div role="status"><Notice tone={noticeTone}>{notice}</Notice></div>}
      {error && <ErrorNotice message={error} />}
      <div className="ow-prog">
        {reviews.length > 0 && <Band icon={Users} title={`${nf.format(reviews.length)} ${reviews.length === 1 ? "Empfehlung braucht" : "Empfehlungen brauchen"} deine Prüfung`} sub="Ohne deine Entscheidung wird nichts gutgeschrieben." onClick={() => open(`review:${reviews[0].id}`)} />}
        <Rows title="Bonusregel" helpTitle="So funktioniert es" note="Wenn die Regel aktiv ist, muss mindestens ein Bonus größer als null sein. Die Beträge werden bei der Anmeldung festgehalten; spätere Änderungen schreiben vorhandene Empfehlungen nicht um." help={<>
          <ol className="ow-steps-list"><li>Eine Person teilt den Link ihrer Karte.</li><li>Eine neue Karte wird über diesen Link erstellt. Dafür gibt es noch keinen Bonus.</li><li>Die erste Buchung der neuen Karte wird an deiner Kasse bestätigt. Dann werden beide konfigurierten Boni einmalig im Buchungsjournal erfasst.</li></ol>
          <p>Melden sich zwei Karten mit derselben bestätigten E-Mail-Adresse an, hält Loynara die Empfehlung zur Prüfung an. Ganz ausschließen lässt sich Missbrauch nicht, weil Karten keine Namen haben.</p>
        </>}>
          <SwitchRow key="switch" label="Empfehlungen für neue Anmeldungen aktivieren" checked={saved.enabled} disabled={switching} onChange={on => void toggle(on)} />
          {(["referrerBonus", "referredBonus"] as const).map(which => <Row key={which} icon={Plus} title={BONUS[which]} value={saved[which] ? `+${nf.format(saved[which])}` : "Aus"} big={saved[which] > 0} off={!saved[which]} onClick={() => open(which)} />)}
        </Rows>
        {!untouched && <Rows title="Letzte 100 Empfehlungen">
          {list.state === "loading" ? <LoadingBlock key="loading" rows={1} height={64} />
            : list.state === "error" ? <ErrorNotice key="error" message={list.message} onRetry={reloadList} />
              : referrals.length === 0 ? <EmptyState key="none" level={3} size="compact" title="Noch keine Anmeldungen über Empfehlungslinks.">Gäste finden ihren Empfehlungslink auf ihrer Karte unter „Karte empfehlen“.</EmptyState>
                : referrals.map(item => <Row key={item.id} icon={Users} title={`${item.referrerCard} → ${item.referredCard}`}
                  sub={item.status === "review" && item.reviewReason ? reviewReason(item.reviewReason) : status(item.status)}
                  {...(item.status === "review" ? { chip: { label: status(item.status), warn: true }, onClick: () => open(`review:${item.id}`) } : {})} />)}
        </Rows>}
      </div>
    </div>
  );
}

/** One bonus as one question with its own save (R18); the server keeps the rule's other values as they are. */
function BonusQuestion({ which, saved, unit, onBack, save }: { which: Bonus; saved: Settings; unit: { one: string; many: string }; onBack: () => void; save: (value: number) => Promise<void> }) {
  const [draft, setDraft] = useState(String(saved[which]));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const [tried, setTried] = useState(false);
  const other = which === "referrerBonus" ? saved.referredBonus : saved.referrerBonus;
  const problem = !wholeIn(draft, 0, 1000) ? rangeError(0, 1000) : saved.enabled && Number(draft) === 0 && other === 0 ? ONE_BONUS : "";
  async function submit() {
    if (busy) return;
    if (problem) { setTried(true); document.getElementById("rf-bonus")?.focus(); return; }
    setBusy(true); setFailed("");
    try { await save(Number(draft)); }
    catch (cause) { setFailed(cause instanceof Error ? cause.message : "Die Regel konnte nicht gespeichert werden."); setBusy(false); }
  }
  return (
    <QuestionForm title={BONUS[which]} back={{ label: "Empfehlungen", onClick: onBack }} busy={busy} failed={failed} onSubmit={() => void submit()}>
      <Control id="rf-bonus" label="Bonus" hint={`0 bis 1000 ${unit.many}`} error={tried ? problem : ""}>
        <NumberStepper id="rf-bonus" value={draft} onChange={setDraft} min={0} max={1000} unit={unit} bonus offAtZero invalid={tried && Boolean(problem)} describedBy="rf-bonus-hint" />
      </Control>
    </QuestionForm>
  );
}

/** A referral held for the owner's decision, as a step: the reason, then reject with a note or retry the bonus correction. */
function ReviewStep({ referral, onBack, onDone }: { referral: Referral; onBack: () => void; onDone: (message: string, tone: "ok" | "warn") => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const action = referral.hasCreditedBonus ? "retry_reversal" : "reject";
  async function review() {
    setBusy(true); setError("");
    try {
      const outcome = await postJson<{ status: string }>(`/api/merchant/referrals/${encodeURIComponent(referral.id)}/review`, action === "reject" ? { action, reason: note.trim() } : { action });
      if (outcome.status === "review") onDone("Die Bonus-Korrektur ist noch nicht möglich. Der Vorgang bleibt zur Prüfung offen.", "warn");
      else onDone("Prüfentscheidung gespeichert.", "ok");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Die Prüfung konnte nicht gespeichert werden."); setBusy(false); }
  }
  return (
    <Confirm title={`${referral.referrerCard} → ${referral.referredCard}`} back="Empfehlungen" busy={busy} danger={action === "reject"} disabled={action === "reject" && note.trim().length < 10}
      action={action === "reject" ? "Empfehlung ablehnen" : "Bonus-Korrektur erneut prüfen"} busyAction={action === "reject" ? "Speichert …" : "Prüft …"} onConfirm={() => void review()} onCancel={onBack}>
      <div className="ow-qpanel"><p><span className="ow-chip ow-chip--warn ow-chip--state">{status(referral.status)}</span></p>{referral.reviewReason && <p className="ow-qreason">{reviewReason(referral.reviewReason)}</p>}</div>
      {action === "reject" && <div className="ow-qpanel ow-field"><label htmlFor="rf-note">Prüfvermerk</label><input id="rf-note" className="ow-input" value={note} onChange={event => setNote(event.target.value)} minLength={10} maxLength={240} placeholder="Grund für die Ablehnung" /></div>}
      {error && <ErrorNotice message={error} />}
    </Confirm>
  );
}
