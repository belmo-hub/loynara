import { describe, expect, it } from "vitest";
import { requireRecentOwnerSession } from "./lifecycle-policy";
const now = new Date('2026-10-15T12:00:00.000Z');
describe('merchant deletion authentication', () => {
  it('accepts an unexpired owner login at the ten-minute boundary', () => {
    expect(() => requireRecentOwnerSession({ role: 'owner', active: true, createdAt: new Date(now.getTime()-600000), expiresAt: new Date(now.getTime()+1) }, now)).not.toThrow();
  });
  it.each(['manager','cashier'])('refuses a recently authenticated %s', role => {
    expect(() => requireRecentOwnerSession({ role, active: true, createdAt: now, expiresAt: new Date(now.getTime()+1) }, now)).toThrow();
  });
  it.each([600001,-1,NaN])('refuses stale, future or invalid authentication (%s)', age => {
    expect(() => requireRecentOwnerSession({ role:'owner',active:true,createdAt:new Date(now.getTime()-age),expiresAt:new Date(now.getTime()+1) },now)).toThrow();
  });
  it('refuses revoked access or an expired session', () => {
    expect(() => requireRecentOwnerSession({role:'owner',active:false,createdAt:now,expiresAt:new Date(now.getTime()+1)},now)).toThrow();
    expect(() => requireRecentOwnerSession({role:'owner',active:true,createdAt:now,expiresAt:now},now)).toThrow();
  });
});
