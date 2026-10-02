export type TapMode = "disabled" | "automatic_fixed" | "staff_confirmed";

/**
 * Pilot policy for the NFC options. "automatic_fixed" is offered only where the server allows it
 * (never on the production deployment); it stays visible, but disabled, when a programme already
 * has it saved so the owner can see the state and move away from it. The server enforces the same
 * rule independently.
 */
export function tapModesFor<T extends { id: TapMode }>(all: T[], saved: TapMode, automaticAllowed: boolean): T[] {
  return all.filter(item => item.id !== "automatic_fixed" || automaticAllowed || saved === "automatic_fixed");
}
