export type AdminRole = "founder" | "support" | "sales";
export type Capability = "home.view" | "home.money" | "shops.view" | "shops.note" | "plaques.view" | "plaques.link" | "plaques.code" | "plaques.retire" | "support.reset_link" | "support.resend_invite" | "support.unlock" | "leads.view" | "leads.edit" | "leads.invite" | "money.view_full" | "money.view_status" | "money.write" | "health.view" | "health.retry" | "customers.reveal" | "audit.view_all" | "audit.view_own" | "admins.reset_2fa";
export const STEP_UP_CAPABILITIES: ReadonlySet<Capability> = new Set(["plaques.link", "plaques.code", "plaques.retire", "support.unlock", "leads.invite", "money.write", "health.retry", "customers.reveal", "admins.reset_2fa"]);
const common: Capability[] = ["home.view", "shops.view", "shops.note", "plaques.view", "leads.view", "leads.edit", "money.view_status", "audit.view_own"];
const capabilities: Record<AdminRole, ReadonlySet<Capability>> = {
  founder: new Set([...common, ...STEP_UP_CAPABILITIES, "home.money", "support.reset_link", "support.resend_invite", "money.view_full", "health.view", "audit.view_all"]),
  support: new Set([...common, "home.money", "plaques.link", "plaques.code", "plaques.retire", "support.reset_link", "support.resend_invite", "support.unlock", "health.view", "health.retry"]),
  sales: new Set([...common, "leads.invite"]),
};
export function can(roles: readonly AdminRole[], capability: Capability): boolean {
  return roles.some(role => capabilities[role]?.has(capability) === true);
}
