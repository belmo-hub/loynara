import { z } from "zod";

const EVENT_KEY = "looplocal.offline.events.v1";
const DEVICE_KEY = "looplocal.offline.device.v1";
const award = z.union([
  z.object({ quantity: z.number().int().min(1).max(1000) }).strict(),
  z.object({ purchaseAmountMinor: z.number().int().min(1).max(1_000_000), ruleVersionId: z.uuid() }).strict(),
]);
const event = z.object({
  eventId: z.uuid(), leaseId: z.uuid(), actorUserId: z.string().min(1), membershipId: z.uuid(),
  // Display only: the card number the cashier saw. Never a credential; events stored before it existed have none.
  cardLocator: z.string().regex(/^K-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/).optional(),
  eventAt: z.iso.datetime(), award,
  state: z.enum(["pending", "accepted", "rejected"]), reason: z.string().max(48).optional(),
}).strict();
const events = z.array(event).max(20);
export type OfflineQueuedEvent = z.infer<typeof event>;

function readAll(storage: Storage): OfflineQueuedEvent[] {
  const raw = storage.getItem(EVENT_KEY);
  if (!raw) return [];
  try { return events.parse(JSON.parse(raw)); }
  catch { throw new Error("Local offline queue is unreadable; stop awarding and ask a manager to review this browser."); }
}

function save(storage: Storage, value: OfflineQueuedEvent[]) {
  storage.setItem(EVENT_KEY, JSON.stringify(events.parse(value)));
}

export function getOfflineDeviceId(storage: Storage): string {
  const current = storage.getItem(DEVICE_KEY);
  if (current) {
    if (!z.uuid().safeParse(current).success) throw new Error("Local offline device ID is unreadable");
    return current;
  }
  const id = crypto.randomUUID();
  storage.setItem(DEVICE_KEY, id);
  return id;
}

export function readOfflineEvents(storage: Storage, actorUserId: string): OfflineQueuedEvent[] {
  return readAll(storage).filter(item => item.actorUserId === actorUserId);
}

export function pendingOfflineCount(storage: Storage): number {
  return readAll(storage).filter(item => item.state === "pending").length;
}

export function addOfflineEvent(storage: Storage, input: OfflineQueuedEvent): void {
  const current = readAll(storage);
  if (current.length >= 20) throw new Error("Offline queue limit reached; synchronize or review existing events first.");
  if (current.some(item => item.eventId === input.eventId)) throw new Error("Offline event ID already exists");
  if (input.state !== "pending") throw new Error("A new offline event must be pending");
  save(storage, [...current, event.parse(input)]);
}

export function resolveOfflineEvent(storage: Storage, eventId: string, result: { status: "accepted" | "rejected"; reason?: string; balance?: number }): void {
  const current = readAll(storage);
  const index = current.findIndex(item => item.eventId === eventId);
  if (index < 0) throw new Error("Offline event not found");
  current[index] = event.parse({ ...current[index], state: result.status, reason: result.status === "rejected" ? result.reason ?? "SERVER_REJECTED" : undefined });
  save(storage, current);
}

export function acknowledgeOfflineEvent(storage: Storage, eventId: string): void {
  const current = readAll(storage);
  const selected = current.find(item => item.eventId === eventId);
  if (!selected) throw new Error("Offline event not found");
  if (selected.state === "pending") throw new Error("A pending offline event cannot be acknowledged");
  save(storage, current.filter(item => item.eventId !== eventId));
}
