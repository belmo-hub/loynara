import type { listAdminEvents } from "@/lib/admin/audit";
type Event = Awaited<ReturnType<typeof listAdminEvents>>[number];
export function AdminAuditEvent({ event, label, identities }: { event: Event; label: string; identities: Record<string, string> }) {
  return <article className="ow-card ow-stack"><h2>{label}</h2><p>{event.summary}</p><p className="ow-muted"><time dateTime={event.at.toISOString()}>{event.at.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}</time> · {event.actor === "operator_cli" ? "Betrieb" : "Konsole"}</p><p>Ausgeführt von: {event.adminUserId ? identities[event.adminUserId] ?? event.adminUserId : "Betrieb (siehe Zusammenfassung)"}</p>{event.targetId && <p>Betroffenes Konto: {identities[event.targetId] ?? event.targetId}</p>}{event.reason && <p>Grund: {event.reason}</p>}</article>;
}
