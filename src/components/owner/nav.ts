import type { MeResponse } from "@/components/client-api";
import type { PilotSurface } from "@/lib/pilot-surfaces";

export type OwnerRole = MeResponse["role"];
export type NavIconName = "home" | "loyalty" | "users" | "megaphone" | "gear";
export type SubItem = { label: string; href: string; roles: OwnerRole[]; exactMatch?: boolean; surface?: PilotSurface };
export type NavGroup = { id: string; label: string; icon: NavIconName; roles: OwnerRole[]; prefixes: string[]; exact?: boolean; items: SubItem[]; /** Label once pilot-hidden items leave only reports behind. */ trimmedLabel?: string };
/** Surfaces withheld on this deployment (from /api/me). Hidden items vanish from the navigation; a group with no visible item vanishes too. */
export type HiddenSurfaces = readonly PilotSurface[];

const OWNER: OwnerRole[] = ["owner"];
const BOTH: OwnerRole[] = ["owner", "manager"];

// Five destinations, two levels. Every pre-existing URL stays reachable and unchanged.
export const NAV_GROUPS: NavGroup[] = [
  { id: "overview", label: "Übersicht", icon: "home", roles: BOTH, prefixes: ["/merchant"], exact: true, items: [{ label: "Übersicht", href: "/merchant", roles: BOTH }] },
  { id: "program", label: "Treueprogramm", icon: "loyalty", roles: BOTH, prefixes: ["/merchant/program", "/merchant/referrals"], items: [
    { label: "Sammelregeln & Prämien", href: "/merchant/program", roles: BOTH, exactMatch: true },
    { label: "Kundenkarte", href: "/merchant/program/card", roles: OWNER },
    { label: "Empfehlungen", href: "/merchant/referrals", roles: OWNER },
  ] },
  { id: "customers", label: "Kunden", icon: "users", roles: BOTH, prefixes: ["/merchant/customers", "/merchant/audiences"], items: [
    { label: "Kundenkarten", href: "/merchant/customers", roles: BOTH },
    { label: "Zielgruppen", href: "/merchant/audiences", roles: BOTH, surface: "audiences" },
  ] },
  { id: "actions", label: "Aktionen", trimmedLabel: "Auswertung", icon: "megaphone", roles: OWNER, prefixes: ["/merchant/campaigns", "/merchant/automations", "/merchant/wallet-messages", "/merchant/analytics", "/merchant/adviser"], items: [
    { label: "Kampagnen", href: "/merchant/campaigns", roles: OWNER, surface: "campaigns" },
    { label: "Automationen", href: "/merchant/automations", roles: OWNER, surface: "automations" },
    { label: "Nachricht senden", href: "/merchant/wallet-messages", roles: OWNER, surface: "walletMessages" },
    { label: "Ergebnisse", href: "/merchant/analytics", roles: OWNER },
    { label: "Beratung", href: "/merchant/adviser", roles: OWNER },
  ] },
  { id: "settings", label: "Einstellungen", icon: "gear", roles: OWNER, prefixes: ["/merchant/settings", "/merchant/locations", "/merchant/staff", "/merchant/billing"], items: [
    { label: "Geschäft", href: "/merchant/settings", roles: OWNER },
    { label: "Standorte", href: "/merchant/locations", roles: OWNER },
    { label: "Team", href: "/merchant/staff", roles: OWNER },
    { label: "Abrechnung", href: "/merchant/billing", roles: OWNER, surface: "billing" },
  ] },
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

const shown = (item: SubItem, role: OwnerRole, hidden: HiddenSurfaces) => item.roles.includes(role) && !(item.surface && hidden.includes(item.surface));
export const groupLabel = (group: NavGroup, hidden: HiddenSurfaces = []) => group.trimmedLabel && hidden.includes("campaigns") ? group.trimmedLabel : group.label;

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
