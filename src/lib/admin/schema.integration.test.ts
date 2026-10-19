import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { pool } from "@/db";
if (!process.env.DATABASE_URL?.endsWith("/looplocal_test") || !["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Dedicated local synthetic database required");
afterAll(() => pool.end());
async function event(at = new Date()) {
  const id = randomUUID();
  await pool.query("INSERT INTO admin_audit_events(id,at,actor,roles,action,summary) VALUES($1,$2,'operator_cli','{}','admin.role_granted','Synthetic event')", [id, at]);
  return id;
}
it("rejects updates to audit events", async () => {
  const id = await event();
  await expect(pool.query("UPDATE admin_audit_events SET summary='changed' WHERE id=$1",[id])).rejects.toThrow(/append.only/i);
});
it("rejects deletes without the retention setting", async () => {
  const id = await event();
  await expect(pool.query("DELETE FROM admin_audit_events WHERE id=$1",[id])).rejects.toThrow(/append.only/i);
});
it("rejects deletes of recent rows even with the retention setting", async () => {
  const id = await event(); const client = await pool.connect();
  try { await client.query("BEGIN"); await client.query("SET LOCAL loynara.audit_retention = 'on'");
    await expect(client.query("DELETE FROM admin_audit_events WHERE id=$1",[id])).rejects.toThrow(/append.only/i);
  } finally { await client.query("ROLLBACK"); client.release(); }
});
it("allows the retention delete of old rows", async () => {
  const id = await event(new Date(Date.now()-1097*86400000)); const client = await pool.connect();
  try { await client.query("BEGIN"); await client.query("SET LOCAL loynara.audit_retention = 'on'");
    expect((await client.query("DELETE FROM admin_audit_events WHERE id=$1",[id])).rowCount).toBe(1); await client.query("COMMIT");
  } finally { await client.query("ROLLBACK"); client.release(); }
});
it("allows one person to hold support and sales", async () => {
  const id = randomUUID();
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,\'Synthetic\',$2,false,now(),now())',[id,`${id}@example.test`]);
  await pool.query("INSERT INTO platform_admins(user_id,role,granted_by) VALUES($1,'support','operator_cli:test'),($1,'sales','operator_cli:test')",[id]);
  expect((await pool.query("SELECT role, granted_at FROM platform_admins WHERE user_id=$1",[id])).rowCount).toBe(2);
  await expect(pool.query("INSERT INTO platform_admins(user_id,role,granted_by) VALUES($1,'owner','operator_cli:test')",[id])).rejects.toThrow(/check constraint/);
});
it("cascades admin session activity when the session is deleted", async () => {
  const id=randomUUID(), session=randomUUID();
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,\'Synthetic\',$2,false,now(),now())',[id,`${id}@example.test`]);
  await pool.query('INSERT INTO "session"(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,$1,$2,now()+interval \'1 day\',now(),now())',[session,id]);
  await pool.query("INSERT INTO admin_session_activity(session_id,user_id,started_at,last_seen_at) VALUES($1,$2,now(),now())",[session,id]);
  await pool.query('DELETE FROM "session" WHERE id=$1',[session]);
  expect((await pool.query("SELECT * FROM admin_session_activity WHERE session_id=$1",[session])).rowCount).toBe(0);
});
it("adds the two-factor schema",async()=>{
  expect((await pool.query('SELECT "twoFactorEnabled" FROM "user" LIMIT 0')).fields[0].name).toBe("twoFactorEnabled");
  expect((await pool.query('SELECT secret,"backupCodes","userId",verified,"failedVerificationCount","lockedUntil" FROM "twoFactor" LIMIT 0')).fields).toHaveLength(6);
});
