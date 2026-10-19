import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { locations, programs, staffRoles } from "@/db/schema";
import { DomainError } from "./loyalty";
import { nfcCapability } from "./nfc-keys";

/**
 * "Ready to start" for one location, derived only from persisted state — never from browser checkboxes.
 *
 * Three groups that must not be confused:
 * - setup: configuration exists (programme, card design, team access);
 * - verify: the real flow has been exercised and left evidence (a card was enrolled, the counter confirmed an
 *   award, a reward was redeemed, NFC tags are live);
 * - external: conditions Loynara cannot check (physical NFC acceptance where no key provider is set up). They are
 *   shown as open on purpose so that "all green" never implies legal or commercial approval.
 */
export type ReadinessStatus = "done" | "todo" | "external" | "not_applicable";
export type ReadinessStep = {
  id: "programme" | "card" | "team" | "enrolment" | "first_award" | "first_redemption" | "nfc";
  group: "setup" | "verify" | "external";
  required: boolean;
  status: ReadinessStatus;
  title: string;
  evidence: string;
  action?: { label: string; href: string; ownerOnly?: boolean };
};
export type LaunchReadiness = {
  locationId: string;
  steps: ReadinessStep[];
  /** One concrete next step with the reason it is next; null when every required step has evidence. */
  next: { stepId: ReadinessStep["id"]; reason: string } | null;
  requiredDone: number;
  requiredTotal: number;
};

// Matches the column default in the schema; a different stored colour is evidence of a saved design.
const DEFAULT_BRAND_COLOR = "#264c45";
const germanDate = (value: Date, timezone: string) => value.toLocaleDateString("de-DE", { timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric" });

export async function getLaunchReadiness(actorUserId: string, locationId: string, env: Record<string, string | undefined> = process.env): Promise<LaunchReadiness> {
  const [staff] = await db.select().from(staffRoles).where(and(eq(staffRoles.userId, actorUserId), eq(staffRoles.active, true)));
  if (!staff || staff.role === "cashier" || (staff.role === "manager" && staff.locationId !== locationId)) throw new DomainError("FORBIDDEN", "Owner or manager access required");
  const [location] = await db.select().from(locations).where(and(eq(locations.id, locationId), eq(locations.tenantId, staff.tenantId)));
  if (!location) throw new DomainError("NOT_FOUND", "Location not found");
  const [program] = await db.select().from(programs).where(and(eq(programs.tenantId, staff.tenantId), eq(programs.locationId, location.id), eq(programs.status, "active")));

  const facts = (await pool.query<{
    rewards: number; reward_title: string | null; reward_cost: number | null; cards: number;
    first_award_at: Date | null; first_redeem_at: Date | null; team: number; pending_invites: number;
    live_tags: number; confirmed_taps: number;
  }>(`
    SELECT
      (SELECT count(*)::int FROM rewards r WHERE r.tenant_id = $1 AND r.program_id = $3 AND r.active) AS rewards,
      (SELECT rv.title FROM rewards r JOIN reward_versions rv ON rv.tenant_id = r.tenant_id AND rv.reward_id = r.id
        WHERE r.tenant_id = $1 AND r.program_id = $3 AND r.active ORDER BY r.sort_order, rv.version DESC LIMIT 1) AS reward_title,
      (SELECT rv.cost FROM rewards r JOIN reward_versions rv ON rv.tenant_id = r.tenant_id AND rv.reward_id = r.id
        WHERE r.tenant_id = $1 AND r.program_id = $3 AND r.active ORDER BY r.sort_order, rv.version DESC LIMIT 1) AS reward_cost,
      (SELECT count(*)::int FROM memberships m JOIN programs p ON p.tenant_id = m.tenant_id AND p.id = m.program_id
        WHERE m.tenant_id = $1 AND p.location_id = $2) AS cards,
      -- Only real counter evidence counts: seed data, referral bonuses and corrected awards do not prove the flow.
      (SELECT min(e.created_at) FROM ledger_entries e WHERE e.tenant_id = $1 AND e.location_id = $2 AND e.kind = 'award'
        AND e.source IN ('staff_online','staff_offline')
        AND NOT EXISTS (SELECT 1 FROM ledger_entries undo WHERE undo.tenant_id = e.tenant_id AND undo.reversal_of_id = e.id)) AS first_award_at,
      (SELECT min(e.created_at) FROM ledger_entries e WHERE e.tenant_id = $1 AND e.location_id = $2 AND e.kind = 'redeem'
        AND NOT EXISTS (SELECT 1 FROM ledger_entries undo WHERE undo.tenant_id = e.tenant_id AND undo.reversal_of_id = e.id)) AS first_redeem_at,
      (SELECT count(*)::int FROM staff_roles s WHERE s.tenant_id = $1 AND s.location_id = $2 AND s.active AND s.role IN ('cashier','manager')) AS team,
      (SELECT count(*)::int FROM staff_invites i WHERE i.tenant_id = $1 AND i.location_id = $2 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()) AS pending_invites,
      (SELECT count(*)::int FROM secure_tags t WHERE t.tenant_id = $1 AND t.location_id = $2 AND t.status = 'active') AS live_tags,
      (SELECT count(*)::int FROM tap_requests q WHERE q.tenant_id = $1 AND q.location_id = $2 AND q.status IN ('confirmed','awarded')) AS confirmed_taps
  `, [staff.tenantId, location.id, program?.id ?? null])).rows[0];

  const unit = program?.type === "points" ? "Punkte" : "Stempel";
  const steps: ReadinessStep[] = [];
  steps.push(program && facts.rewards > 0
    ? { id: "programme", group: "setup", required: true, status: "done", title: "Programm und Prämie", evidence: `${program.type === "stamp" ? "Stempelkarte" : "Punktekarte"} · ${facts.reward_cost} ${unit} → ${facts.reward_title}`, action: { label: "Ansehen", href: "/merchant/program" } }
    : { id: "programme", group: "setup", required: true, status: "todo", title: "Programm und Prämie", evidence: program ? "Es gibt keine aktive Prämie. Kunden wüssten nicht, wofür sie sammeln." : "Für diesen Standort ist kein aktives Programm eingerichtet.", action: { label: "Prämie anlegen", href: "/merchant/program", ownerOnly: true } });
  const customised = location.brandColor.toLowerCase() !== DEFAULT_BRAND_COLOR || Boolean(location.logoData);
  steps.push({ id: "card", group: "setup", required: false, status: customised ? "done" : "todo", title: "Kundenkarte gestaltet", evidence: customised ? "Eigene Markenfarbe ist gespeichert." : "Die Karte nutzt noch die Standardfarbe von Loynara.", action: { label: customised ? "Ändern" : "Karte gestalten", href: "/merchant/program/card", ownerOnly: true } });
  steps.push({ id: "team", group: "setup", required: false, status: facts.team > 0 ? "done" : "todo", title: "Teamzugang für die Kasse",
    evidence: facts.team > 0 ? `${facts.team} aktive${facts.team === 1 ? "r" : ""} Teamzugang an diesem Standort${facts.pending_invites ? `, ${facts.pending_invites} Einladung offen` : ""}.`
      : facts.pending_invites ? `${facts.pending_invites} Einladung noch nicht angenommen. Bis dahin kann nur die Inhaberin oder der Inhaber kassieren.` : "Noch kein eigener Zugang für Mitarbeitende. Allein an der Kasse? Dann reicht „Kasse öffnen“.",
    action: { label: facts.team > 0 ? "Team ansehen" : "Person einladen", href: "/merchant/staff", ownerOnly: true } });

  steps.push(facts.cards > 0
    ? { id: "enrolment", group: "verify", required: true, status: "done", title: "Erste Karte angemeldet", evidence: `${facts.cards} ${facts.cards === 1 ? "Karte" : "Karten"} an diesem Standort.` }
    : { id: "enrolment", group: "verify", required: true, status: "todo", title: "Erste Karte angemeldet", evidence: "Noch keine Karte. Melde dich mit dem Anmeldelink oder dem Tresenschild selbst an.", action: { label: "Anmeldelink öffnen", href: "/merchant/settings" } });
  steps.push(facts.first_award_at
    ? { id: "first_award", group: "verify", required: true, status: "done", title: "Erste Gutschrift an der Kasse bestätigt", evidence: `Erstmals am ${germanDate(facts.first_award_at, location.timezone)}; nicht korrigiert.` }
    : { id: "first_award", group: "verify", required: true, status: "todo", title: "Erste Gutschrift an der Kasse bestätigt", evidence: "Noch keine bestätigte Kassen-Gutschrift. Demo-Daten, Empfehlungsboni, NFC-Taps und korrigierte Vorgänge zählen hier nicht.", action: { label: "Kasse öffnen", href: "/cashier" } });
  steps.push(facts.first_redeem_at
    ? { id: "first_redemption", group: "verify", required: false, status: "done", title: "Einlösung einmal durchgespielt", evidence: `Erstmals am ${germanDate(facts.first_redeem_at, location.timezone)}.` }
    : { id: "first_redemption", group: "verify", required: false, status: "todo", title: "Einlösung einmal durchgespielt", evidence: "Noch keine Prämie eingelöst. Ein Probelauf zeigt dem Team, wie die Bestätigung aussieht.", action: { label: "Kasse öffnen", href: "/cashier" } });

  const nfc = nfcCapability(env);
  if (!nfc.available) steps.push({ id: "nfc", group: "external", required: false, status: "external", title: "NFC am Tresen", evidence: "In dieser Umgebung ist keine NFC-Schlüsselverwaltung eingerichtet. Tags, Schlüssel und der Test mit echten Telefonen werden außerhalb von Loynara freigegeben. QR-Code und Kartennummer funktionieren unabhängig davon." });
  else if (program?.tapMode === "staff_confirmed") steps.push({ id: "nfc", group: "verify", required: false, status: facts.live_tags > 0 && facts.confirmed_taps > 0 ? "done" : "todo", title: "NFC-Tag am Tresen geprüft",
    evidence: facts.live_tags === 0 ? "NFC ist eingeschaltet, aber an diesem Standort ist kein aktiver Tag registriert." : facts.confirmed_taps === 0 ? `${facts.live_tags} aktiver Tag, aber noch kein bestätigter Tap. Ein lesbarer Tag beweist noch keinen Kassenvorgang.` : `${facts.live_tags} aktiver Tag, ${facts.confirmed_taps} bestätigte Taps.`,
    action: { label: "NFC-Einstellungen", href: "/merchant/program", ownerOnly: true } });
  else steps.push({ id: "nfc", group: "verify", required: false, status: "not_applicable", title: "NFC am Tresen", evidence: "NFC ist für dieses Programm ausgeschaltet. QR-Code und Kartennummer reichen für den Start." });

  const order: ReadinessStep["id"][] = ["programme", "enrolment", "first_award", "team", "card", "first_redemption", "nfc"];
  const reasons: Partial<Record<ReadinessStep["id"], string>> = {
    programme: "Ohne aktive Prämie hat eine Anmeldung keinen Zweck.",
    enrolment: "Erst mit einer eigenen Karte lässt sich der Ablauf an der Kasse prüfen.",
    first_award: "Eine bestätigte Gutschrift beweist, dass Scan oder Kartennummer, Berechtigung und Buchung zusammen funktionieren.",
    team: "Mitarbeitende brauchen einen eigenen Zugang; das Inhaberkonto wird nicht geteilt.",
    card: "Kunden erkennen die Karte an deiner Farbe.",
    first_redemption: "Die Einlösung ist der Moment, den Kunden erleben; einmal durchspielen vermeidet Unsicherheit am ersten Tag.",
    nfc: "NFC ist eingeschaltet, aber noch nicht mit einem echten Tap belegt.",
  };
  const nextStep = order.map(id => steps.find(step => step.id === id)!).find(step => step.status === "todo" && (step.required || !step.action?.ownerOnly || staff.role === "owner"));
  const required = steps.filter(step => step.required);
  return {
    locationId: location.id,
    steps,
    next: nextStep ? { stepId: nextStep.id, reason: reasons[nextStep.id] ?? "" } : null,
    requiredDone: required.filter(step => step.status === "done").length,
    requiredTotal: required.length,
  };
}
