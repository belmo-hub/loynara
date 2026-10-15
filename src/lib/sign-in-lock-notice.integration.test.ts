import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { outboxJobs } from "@/db/schema";
import { auth } from "./auth";
import { createMerchant } from "./product";
import { acceptStaffInvite, createStaffInvite, revokeStaff } from "./staff";
import { deliverSignInLockNotice, SIGN_IN_LOCK_NOTICE } from "./sign-in-lock-notice";
import { POST } from "@/app/api/auth/[...all]/route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test") || !["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Dedicated local synthetic database required");

// The owner of a locked account, and for staff the merchant's owner, learn about it by email; nobody gets flooded.
const origin = "http://localhost:3000";
const password = "synthetic-lock-notice-password";
const previous = { ingress: process.env.TRUSTED_INGRESS, registration: process.env.PUBLIC_REGISTRATION_ENABLED, smtp: process.env.SMTP_HOST, base: process.env.PUBLIC_BASE_URL, external: process.env.EXTERNAL_EMAIL_ENABLED };
let address = 0;
beforeEach(async () => {
  await pool.query('TRUNCATE tenants, "user", rate_limits CASCADE');
  process.env.TRUSTED_INGRESS = "cloudflare_tunnel";
  process.env.PUBLIC_REGISTRATION_ENABLED = "true";
  process.env.SMTP_HOST = "localhost";
  process.env.PUBLIC_BASE_URL = origin;
  process.env.EXTERNAL_EMAIL_ENABLED = "false";
});
afterAll(async () => {
  for (const [key, value] of Object.entries({ TRUSTED_INGRESS: previous.ingress, PUBLIC_REGISTRATION_ENABLED: previous.registration, SMTP_HOST: previous.smtp, PUBLIC_BASE_URL: previous.base, EXTERNAL_EMAIL_ENABLED: previous.external })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await pool.end();
});

function signIn(email: string, attempt: string) {
  address += 1;
  return POST(new Request(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", "cf-connecting-ip": `203.0.${Math.floor(address / 250) % 250}.${address % 250 + 1}` },
    body: JSON.stringify({ email, password: attempt }),
  }));
}
async function lockOut(email: string) {
  for (let i = 0; i < 11; i += 1) await signIn(email, `wrong-guess-${i}-padding`);
}
async function identity() {
  const email = `${randomUUID()}@example.test`;
  const result = await auth.api.signUpEmail({ body: { name: "Synthetic lock identity", email, password } });
  return { userId: result.user.id, email };
}
async function merchant() {
  const owner = await identity();
  const created = await createMerchant({ userId: owner.userId, businessName: "Lock notice café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Lock notice", programType: "stamp", rulesText: "One stamp per coffee", rewardTitle: "Coffee", rewardCost: 5 });
  const cashier = await identity();
  const invite = await createStaffInvite({ actorUserId: owner.userId, locationId: created.locationId, email: cashier.email, role: "cashier" });
  await acceptStaffInvite({ userId: cashier.userId, token: invite.token });
  return { owner, cashier, tenantId: created.tenantId };
}
const notices = () => db.select().from(outboxJobs).where(eq(outboxJobs.kind, SIGN_IN_LOCK_NOTICE));
async function deliverAll() {
  const sent: { to: string; subject: string; body: string }[] = [];
  for (const job of await notices()) {
    expect(await deliverSignInLockNotice(job, async message => { sent.push(message); })).toEqual({ status: "complete" });
  }
  return sent;
}

it("tells an owner whose own account was locked, without putting the address into the queued job", async () => {
  const { owner } = await merchant();
  await lockOut(owner.email);
  const jobs = await notices();
  expect(jobs).toHaveLength(1);
  expect(JSON.stringify(jobs[0].payload)).not.toContain("@");
  const sent = await deliverAll();
  expect(sent.map(message => message.to)).toEqual([owner.email]);
  expect(sent[0].subject).toContain("gesperrt");
  expect(sent[0].body).toContain("15 Minuten");
  expect(sent[0].body).not.toContain("wrong-guess");
});

it("tells both the cashier and the merchant's owner when a cashier account is locked", async () => {
  const { owner, cashier } = await merchant();
  await lockOut(cashier.email);
  const sent = await deliverAll();
  expect(sent.map(message => message.to).sort()).toEqual([cashier.email, owner.email].sort());
  expect(sent.find(message => message.to === owner.email)!.body).toContain(cashier.email);
});

it("sends at most one round of notices per account per day, however often the lock is triggered", async () => {
  const { owner } = await merchant();
  await lockOut(owner.email);
  for (let i = 0; i < 5; i += 1) await signIn(owner.email, `more-guesses-${i}-padding`);
  // Simulate the fifteen-minute lock window running out (only the sign-in counter), then a second lock the same day.
  const lockKey = createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update("auth_signin_account_failure").update("\0").update(owner.email.toLowerCase()).digest("hex");
  expect((await pool.query("DELETE FROM rate_limits WHERE key_hash = $1", [lockKey])).rowCount).toBe(1);
  await lockOut(owner.email);
  expect(await notices()).toHaveLength(1);
});

it("queues nothing for an unknown address or an account without an active merchant role", async () => {
  const loose = await identity();
  await lockOut(loose.email);
  await lockOut(`${randomUUID()}@example.test`);
  const { owner, cashier } = await merchant();
  await revokeStaff({ actorUserId: owner.userId, userId: cashier.userId });
  await lockOut(cashier.email);
  expect(await notices()).toHaveLength(0);
});

it("does not send to someone who lost owner access between queueing and delivery", async () => {
  const { owner, cashier } = await merchant();
  await lockOut(cashier.email);
  await pool.query("UPDATE staff_roles SET active = false WHERE user_id = $1", [owner.userId]);
  const send = vi.fn(async () => {});
  const results = [];
  for (const job of await notices()) results.push(await deliverSignInLockNotice(job, send));
  expect(results.map(result => result.status).sort()).toEqual(["complete", "suppressed"]);
  expect(send).toHaveBeenCalledTimes(1);
});
