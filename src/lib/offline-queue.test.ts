import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { acknowledgeOfflineEvent, addOfflineEvent, getOfflineDeviceId, readOfflineEvents, resolveOfflineEvent } from "./offline-queue";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, clear: () => values.clear(), key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(key) ?? null, removeItem: key => { values.delete(key); }, setItem: (key, value) => { values.set(key, value); } };
}

function pending(actorUserId: string) {
  return { eventId: randomUUID(), leaseId: randomUUID(), actorUserId, membershipId: randomUUID(),
    eventAt: new Date().toISOString(), award: { quantity: 1 }, state: "pending" as const };
}

describe("bounded offline browser queue", () => {
  it("survives reload, scopes visible events to the signed-in actor, and never saves a scan credential", () => {
    const storage = memoryStorage();
    const actor = randomUUID();
    const device = getOfflineDeviceId(storage);
    expect(getOfflineDeviceId(storage)).toBe(device);
    const event = pending(actor);
    addOfflineEvent(storage, event);
    expect(readOfflineEvents(storage, actor)).toMatchObject([event]);
    expect(readOfflineEvents(storage, randomUUID())).toEqual([]);
    expect(JSON.stringify(readOfflineEvents(storage, actor))).not.toMatch(/sc_[A-Za-z0-9_-]{32}|card_[A-Za-z0-9_-]{32}/);
    expect(() => acknowledgeOfflineEvent(storage, event.eventId)).toThrow(/pending/i);
    resolveOfflineEvent(storage, event.eventId, { status: "accepted", balance: 1 });
    acknowledgeOfflineEvent(storage, event.eventId);
    expect(readOfflineEvents(storage, actor)).toEqual([]);
  });

  it("caps unreviewed events and refuses a corrupt store instead of silently discarding awards", () => {
    const storage = memoryStorage();
    const actor = randomUUID();
    for (let index = 0; index < 20; index++) addOfflineEvent(storage, pending(actor));
    expect(() => addOfflineEvent(storage, pending(actor))).toThrow(/limit/i);
    storage.setItem("looplocal.offline.events.v1", "not-json");
    expect(() => readOfflineEvents(storage, actor)).toThrow(/unreadable/i);
  });
});
