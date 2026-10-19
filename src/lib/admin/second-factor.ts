// User-scoped checks use the same decryption, OTP and password internals as
// the installed authentication plugin; its endpoints require session headers.
import { sql } from "drizzle-orm";
import { symmetricDecrypt } from "better-auth/crypto";
import { createOTP } from "@better-auth/utils/otp";
import { db } from "@/db";
import { auth } from "@/lib/auth";
import type { Transaction } from "./types";

export async function hasSecondFactor(userId: string): Promise<boolean> {
  const result = await db.execute(sql`SELECT 1 FROM "user" u JOIN "twoFactor" f ON f."userId"=u.id WHERE u.id=${userId} AND u."twoFactorEnabled"=true AND f.verified=true`);
  return result.rows.length > 0;
}
export async function verifyAdminSecondFactor(userId: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const result = await db.execute<{ secret: string }>(sql`SELECT f.secret FROM "user" u JOIN "twoFactor" f ON f."userId"=u.id WHERE u.id=${userId} AND u."twoFactorEnabled"=true AND f.verified=true`);
  if (!result.rows[0]) return false;
  const context = await auth.$context;
  const secret = await symmetricDecrypt({ key: context.secretConfig, data: result.rows[0].secret });
  return createOTP(secret, { period: 30, digits: 6 }).verify(code);
}
export async function verifyAdminPassword(userId: string, password: string): Promise<boolean> {
  const context = await auth.$context;
  if (password.length > context.password.config.maxPasswordLength) return false;
  const account = await context.internalAdapter.findCredentialAccount(userId);
  return !!account?.password && context.password.verify({ hash: account.password, password });
}
export async function resetSecondFactor(tx: Transaction, userId: string): Promise<void> {
  await tx.execute(sql`UPDATE "user" SET "twoFactorEnabled"=false, "updatedAt"=now() WHERE id=${userId}`);
  await tx.execute(sql`DELETE FROM "twoFactor" WHERE "userId"=${userId}`);
  await tx.execute(sql`DELETE FROM admin_session_activity WHERE user_id=${userId}`);
  await tx.execute(sql`DELETE FROM "session" WHERE "userId"=${userId}`);
  await tx.execute(sql`DELETE FROM verification WHERE value=${userId}`);
}
