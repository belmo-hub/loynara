import type { MeResponse } from "@/components/client-api";

export type OwnerRole = MeResponse["role"];
export type NavIconName = "home" | "loyalty" | "users" | "megaphone" | "gear";
export type SubItem = { label: string; href: string; roles: OwnerRole[]; match?: string[] };
export type NavGroup = { id: string; label: string; icon: NavIconName; roles: OwnerRole[]; prefixes: string[]; exact?: boolean; items: SubItem[] };

const OWNER: OwnerRole[] = ["owner"];
const BOTH: OwnerRole[] = ["owner", "manager"];

// Five destinations, two levels. Every pre-existing URL stays reachable and unchanged.
export const NAV_GROUPS: NavGroup[] = [
  { id: "overview", label: "Übersicht", icon: "home", roles: BOTH, prefixes: ["/merchant"], exact: true, items: [{ label: "Übersicht", href: "/merchant", roles: BOTH }] },
  { id: "program", label: "Treueprogramm", icon: "loyalty", roles: BOTH, prefixes: ["/merchant/program", "/merchant/referrals"], items: [
    { label: "Sammelregeln & Prämien", href: "/merchant/program", roles: BOTH },
    { label: "Empfehlungen", href: "/merchant/referrals", roles: OWNER },
  ] },
  { id: "customers", label: "Kunden", icon: "users", roles: BOTH, prefixes: ["/merchant/customers", "/merchant/audiences"], items: [
    { label: "Kundenkarten", href: "/merchant/customers", roles: BOTH },
    { label: "Zielgruppen", href: "/merchant/audiences", roles: BOTH },
  ] },
  { id: "actions", label: "Aktionen", icon: "megaphone", roles: OWNER, prefixes: ["/merchant/campaigns", "/merchant/automations", "/merchant/analytics", "/merchant/adviser"], items: [
    { label: "Kampagnen", href: "/merchant/campaigns", roles: OWNER },
    { label: "Automationen", href: "/merchant/automations", roles: OWNER },
    { label: "Ergebnisse", href: "/merchant/analytics", roles: OWNER },
    { label: "Beratung", href: "/merchant/adviser", roles: OWNER },
  ] },
  { id: "settings", label: "Einstellungen", icon: "gear", roles: OWNER, prefixes: ["/merchant/settings", "/merchant/locations", "/merchant/staff", "/merchant/billing"], items: [
    { label: "Geschäft", href: "/merchant/settings", roles: OWNER },
    { label: "Standorte", href: "/merchant/locations", roles: OWNER },
    { label: "Team", href: "/merchant/staff", roles: OWNER },
    { label: "Abrechnung", href: "/merchant/billing", roles: OWNER },
  ] },
];

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

export function visibleGroups(role: OwnerRole) { return NAV_GROUPS.filter(group => group.roles.includes(role)); }

export function activeGroup(path: string, role: OwnerRole): NavGroup | undefined {
  const groups = visibleGroups(role);
  return groups.find(group => group.exact ? path === "/merchant" : group.prefixes.some(prefix => under(path, prefix)));
}

export function activeItem(group: NavGroup, path: string, role: OwnerRole) {
  return group.items.filter(item => item.roles.includes(role)).find(item => under(path, item.href));
}
export function groupHref(group: NavGroup, role: OwnerRole) { return group.items.find(item => item.roles.includes(role))?.href ?? "/merchant"; }
