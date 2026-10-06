/** Single source of truth for per-role manual award caps; the server enforces them, the cashier UI mirrors them. */
export type StaffRole = "owner" | "manager" | "cashier";

export function manualAwardLimit(role: StaffRole | null | undefined): number {
  return role === "manager" ? 100 : role === "owner" ? 1000 : 10;
}

/** The quantity picker never offers more than the server accepts, and never more than its long-standing 100 ceiling. */
export function quantityPickerMax(role: StaffRole | null | undefined): number {
  return Math.min(manualAwardLimit(role), 100);
}
