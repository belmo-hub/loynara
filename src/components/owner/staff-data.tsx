/** What /api/staff returns (lib/staff.ts), and its labels, for the Team page and its invite question. */
export type StaffMember = { userId: string; email?: string; role: "owner" | "manager" | "cashier"; locationId: string | null; active: boolean };
export type Invitation = { id: string; email: string; role: "manager" | "cashier"; locationId: string; expiresAt: string; status: "pending" | "accepted" | "revoked" | "expired" };
export const INVITATION_LABEL = { pending: "Offen", accepted: "Angenommen", revoked: "Widerrufen", expired: "Abgelaufen" } as const;
export const ROLE_LABEL = { owner: "Inhaber:in", manager: "Leitung", cashier: "Kasse" } as const;
export const ROLE_HINT = { manager: "Alles von Kasse, dazu Kundenkarten, Korrekturen und Neuausstellung für diesen Standort." } as const;

/** The Kasse role hint in the programme's unit; purchase points have no manual limit to name (award-limits.ts). */
export const cashierHint = (programType: "stamp" | "points" | undefined, earningMode: "manual" | "purchase" | undefined) => programType === "points" && earningMode === "purchase"
  ? "Bucht an der Kasse, sieht keine Kundenliste und keine Zahlen."
  : `Bucht an der Kasse. Bis 10 ${programType === "points" ? "Punkte" : "Stempel"} je Buchung, sieht keine Kundenliste und keine Zahlen.`;

/** Mirrors the server checks (lib/loyalty, card-reissue, merchant-members, owner-only APIs); the server stays the authority. */
const PERMISSIONS: Array<[string, boolean, boolean]> = [
  ["Stempel oder Punkte vergeben und Prämien einlösen", true, true],
  ["Kundenkarten und ihren Verlauf ansehen", false, true],
  ["Fehlbuchungen korrigieren (bis 100 je Vorgang)", false, true],
  ["Verlorene Karte neu ausstellen", false, true],
  ["Programm ansehen", false, true],
  ["Programm und Prämien ändern", false, false],
  ["Empfehlungen verwalten und Ergebnisse ansehen", false, false],
  ["Team einladen und sperren", false, false],
];

/** „Wer darf was?“: the role table, in its sheet on the Team page. */
export function PermissionTable() {
  return <div className="ow-table-wrap"><table className="ow-perm">
    <thead><tr><th scope="col">Aufgabe</th><th scope="col">Kasse</th><th scope="col">Leitung</th><th scope="col">Inhaber:in</th></tr></thead>
    <tbody>{PERMISSIONS.map(([task, cashier, manager]) => <tr key={task}><th scope="row">{task}</th>{[cashier, manager, true].map((allowed, index) => <td key={index}>{allowed ? <span className="ow-perm-yes" aria-label="erlaubt">✓</span> : <span className="ow-perm-no" aria-label="nicht erlaubt">–</span>}</td>)}</tr>)}</tbody>
  </table></div>;
}
