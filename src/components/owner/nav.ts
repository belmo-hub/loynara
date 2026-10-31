import type { MeResponse } from "@/components/client-api";
import type { PilotSurface } from "@/lib/pilot-surfaces";

export type OwnerRole = MeResponse["role"];
export type NavIconName = "home" | "loyalty" | "users" | "megaphone" | "gear";
export type SubItem = { label: string; href: string; roles: OwnerRole[]; exactMatch?: boolean; surface?: PilotSurface };
export type NavGroup = { id: string; label: string; icon: NavIconName; roles: OwnerRole[]; prefixes: string[]; exact?: boolean; items: SubItem[] };
/** Surfaces withheld on this deployment (from /api/me). Hidden items vanish from the navigation; a group with no visible item vanishes too. */
export type HiddenSurfaces = readonly PilotSurface[];

const OWNER: OwnerRole[] = ["owner"];
const BOTH: OwnerRole[] = ["owner", "manager"];
/** The phone's „Mehr“ tab and the desktop's „Einstellungen“: one page of signposts for both. */
export const MORE_HREF = "/merchant/more";

// Five destinations, two levels. Every pre-existing URL stays reachable and unchanged.
export const NAV_GROUPS: NavGroup[] = [
  { id: "overview", label: "Übersicht", icon: "home", roles: BOTH, prefixes: ["/merchant"], exact: true, items: [{ label: "Übersicht", href: "/merchant", roles: BOTH }] },
  // Kundenkarte and Empfehlungen are rows of the Programm list (ENG-099), so the area has no sub-tabs.
  { id: "program", label: "Programm", icon: "loyalty", roles: BOTH, prefixes: ["/merchant/program", "/merchant/referrals"], items: [
    { label: "Programm", href: "/merchant/program", roles: BOTH },
  ] },
  { id: "customers", label: "Kunden", icon: "users", roles: BOTH, prefixes: ["/merchant/customers", "/merchant/audiences"], items: [
    { label: "Kundenkarten", href: "/merchant/customers", roles: BOTH },
    { label: "Zielgruppen", href: "/merchant/audiences", roles: BOTH, surface: "audiences" },
  ] },
  // Aktionen is a list of rows (ENG-122d): Nachricht, Happy Hour, Ergebnisse, Beratung and, where offered, Kampagnen and
  // Automationen open from it, so the area has no sub-tabs; the list leaves out what a deployment withholds.
  { id: "actions", label: "Aktionen", icon: "megaphone", roles: OWNER, prefixes: ["/merchant/actions", "/merchant/campaigns", "/merchant/automations", "/merchant/wallet-messages", "/merchant/analytics", "/merchant/adviser"], items: [
    { label: "Aktionen", href: "/merchant/actions", roles: OWNER },
  ] },
  // Geschäft, Standorte, Team and Abrechnung are rows of the „Mehr“ page (ENG-122c), so the area has no sub-tabs either.
  { id: "settings", label: "Einstellungen", icon: "gear", roles: OWNER, prefixes: [MORE_HREF, "/merchant/settings", "/merchant/locations", "/merchant/staff", "/merchant/billing"], items: [
    { label: "Einstellungen", href: MORE_HREF, roles: OWNER },
  ] },
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

const shown = (item: SubItem, role: OwnerRole, hidden: HiddenSurfaces) => item.roles.includes(role) && !(item.surface && hidden.includes(item.surface));

export function visibleGroups(role: OwnerRole, hidden: HiddenSurfaces = []) {
  return NAV_GROUPS.filter(group => group.roles.includes(role) && group.items.some(item => shown(item, role, hidden)));
}

export function activeGroup(path: string, role: OwnerRole, hidden: HiddenSurfaces = []): NavGroup | undefined {
  const groups = visibleGroups(role, hidden);
  return groups.find(group => group.exact ? path === "/merchant" : group.prefixes.some(prefix => under(path, prefix)));
}

export function visibleItems(group: NavGroup, role: OwnerRole, hidden: HiddenSurfaces = []) { return group.items.filter(item => shown(item, role, hidden)); }
export function activeItem(group: NavGroup, path: string, role: OwnerRole, hidden: HiddenSurfaces = []) {
  return visibleItems(group, role, hidden).find(item => under(path, item.href));
}
export function groupHref(group: NavGroup, role: OwnerRole, hidden: HiddenSurfaces = []) { return visibleItems(group, role, hidden)[0]?.href ?? "/merchant"; }
