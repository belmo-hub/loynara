import { createHash, createPublicKey, publicEncrypt, randomBytes, constants } from "node:crypto";
import { assertLocalTarget } from "./local-guard";

/**
 * Operator identity provisioning for the first-merchant pilot.
 *
 * Creates ONE Better Auth identity (user + credential account) and nothing else: no tenant, location,
 * programme, staff role, invite, session or e-mail. The merchant then signs in and completes the
 * onboarding wizard themselves. The temporary password is generated in-process, never printed and never
 * accepted as an argument; it leaves the process only as an RSA-OAEP envelope sealed to a transport
 * public key whose private half the operator holds off-host.
 */

export const PRODUCTION_TARGET = "loynara-production";
export const LOCAL_TARGET = "local";

export type OperatorTarget = typeof PRODUCTION_TARGET | typeof LOCAL_TARGET;
export type OperatorEnv = Record<string, string | undefined>;

export class OperatorRefusal extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "OperatorRefusal";
  }
}

const refuse = (code: string): never => { throw new OperatorRefusal(code); };

/** Refuses anything that is not exactly the intended deployment. Pure: takes the environment as input. */
export function assertOperatorTarget(target: string | undefined, env: OperatorEnv): OperatorTarget {
  if (target === PRODUCTION_TARGET) {
    if (env.PRODUCTION_ENVIRONMENT !== PRODUCTION_TARGET) refuse("WRONG_ENVIRONMENT_MARKER");
    if (env.NODE_ENV !== "production") refuse("NODE_ENV_NOT_PRODUCTION");
    let database: URL;
    try { database = new URL(env.DATABASE_URL ?? ""); } catch { return refuse("DATABASE_URL_INVALID"); }
    // Private Railway network only: no public TCP proxy, no loopback, no other host.
    if (!["postgres:", "postgresql:"].includes(database.protocol) || !database.hostname.endsWith(".railway.internal")) refuse("DATABASE_NOT_PRIVATE_RAILWAY");
    let auth: URL; let base: URL;
    try { auth = new URL(env.BETTER_AUTH_URL ?? ""); base = new URL(env.PUBLIC_BASE_URL ?? ""); } catch { return refuse("APP_URL_INVALID"); }
    if (auth.protocol !== "https:" || base.protocol !== "https:" || auth.origin !== base.origin || ["localhost", "127.0.0.1", "[::1]"].includes(auth.hostname)) refuse("APP_ORIGIN_NOT_PRODUCTION");
    if (env.PUBLIC_REGISTRATION_ENABLED !== "false") refuse("PUBLIC_REGISTRATION_NOT_DISABLED");
    return PRODUCTION_TARGET;
  }
  if (target === LOCAL_TARGET) {
    if (env.PRODUCTION_ENVIRONMENT === PRODUCTION_TARGET) refuse("LOCAL_TARGET_ON_PRODUCTION");
    try { assertLocalTarget({ databaseUrl: env.DATABASE_URL, authUrl: env.BETTER_AUTH_URL, baseUrl: env.PUBLIC_BASE_URL, nodeEnv: env.NODE_ENV }); } catch { return refuse("NOT_A_LOCAL_TARGET"); }
    return LOCAL_TARGET;
  }
  return refuse("TARGET_REQUIRED");
}

export function normalizeIdentity(input: { email?: string; name?: string }): { email: string; name: string } {
  const email = (input.email ?? "").trim().toLowerCase();
  const name = (input.name ?? "").trim();
  if (email.length > 254 || !/^[^\s@<>"',;:\\()[\]]+@[^\s@<>"',;:\\()[\]]+\.[a-z]{2,}$/.test(email)) refuse("EMAIL_INVALID");
  if (name.length < 1 || name.length > 80 || /[\u0000-\u001f<>]/.test(name)) refuse("NAME_INVALID");
  return { email, name };
}

/** The transport key must be an RSA public key of at least 3072 bits. A private key is refused outright. */
export function loadTransportKey(pem: string | undefined) {
  if (!pem) return refuse("TRANSPORT_KEY_REQUIRED");
  if (/PRIVATE KEY/.test(pem)) refuse("TRANSPORT_KEY_IS_PRIVATE");
  let key;
  try { key = createPublicKey(pem); } catch { return refuse("TRANSPORT_KEY_INVALID"); }
  if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 3072) refuse("TRANSPORT_KEY_TOO_WEAK");
  return key;
}

export const generateTemporaryPassword = () => `Pl!${randomBytes(32).toString("base64url")}`;

export function sealCredential(key: ReturnType<typeof loadTransportKey>, payload: { email: string; temporary_password: string; auth_user_id: string }): string {
  return publicEncrypt({ key, oaepHash: "sha256", padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(JSON.stringify(payload))).toString("base64");
}

export type OperatorResult =
  | { status: "created"; userId: string; envelope: string; audit: AuditRecord }
  | { status: "existing"; userId: string; audit: AuditRecord };
export type AuditRecord = { at: string; status: "created" | "existing"; userId: string; emailSha256Prefix: string; emailDomain: string; credentialAccounts: 1; merchantStateCreated: false; sessionsCreated: 0; emailsSent: 0; passwordChanged: boolean };

export const emailFingerprint = (email: string) => createHash("sha256").update(email).digest("hex").slice(0, 12);

/** The slice of Better Auth's context this tool uses; injected so tests can supply the real one against a test database. */
export type AuthContextLike = {
  password: { hash(password: string): Promise<string>; verify(input: { hash: string; password: string }): Promise<boolean> };
  options: { databaseHooks?: unknown; emailVerification?: { sendVerificationEmail?: unknown } };
  internalAdapter: {
    findUserByEmail(email: string, options?: { includeAccounts?: boolean }): Promise<{ user: { id: string }; accounts: Array<{ providerId: string }> } | null>;
    createUser(user: { email: string; name: string; emailVerified: boolean }, context?: unknown): Promise<{ id: string; email: string } | null>;
    linkAccount(account: { userId: string; providerId: string; accountId: string; password: string }): Promise<unknown>;
  };
};

/**
 * Creates the identity, or reports the existing one. Existing identities are never modified: no password
 * reset, no account linking, no envelope. Everything runs inside the caller-supplied transaction wrapper.
 */
export async function provisionIdentity(input: {
  ctx: AuthContextLike;
  inTransaction: <T>(fn: () => Promise<T>) => Promise<T>;
  identity: { email: string; name: string };
  transportKey: ReturnType<typeof loadTransportKey>;
  now?: () => Date;
}): Promise<OperatorResult> {
  const { ctx, identity } = input;
  const now = input.now ?? (() => new Date());
  // No hook may be able to send e-mail or create side effects as part of user creation.
  if (ctx.options.databaseHooks || ctx.options.emailVerification?.sendVerificationEmail) refuse("UNEXPECTED_AUTH_HOOK");
  const audit = (status: "created" | "existing", userId: string): AuditRecord => ({ at: now().toISOString(), status, userId, emailSha256Prefix: emailFingerprint(identity.email), emailDomain: identity.email.split("@")[1], credentialAccounts: 1, merchantStateCreated: false, sessionsCreated: 0, emailsSent: 0, passwordChanged: false });
  return input.inTransaction(async () => {
    const found = await ctx.internalAdapter.findUserByEmail(identity.email, { includeAccounts: true });
    if (found) {
      // A user without a credential account is an anomaly this tool must not "repair".
      if (found.accounts.filter(account => account.providerId === "credential").length !== 1) refuse("EXISTING_USER_WITHOUT_SINGLE_CREDENTIAL");
      return { status: "existing" as const, userId: found.user.id, audit: audit("existing", found.user.id) };
    }
    const password = generateTemporaryPassword();
    const hash = await ctx.password.hash(password);
    if (!(await ctx.password.verify({ hash, password }))) refuse("HASH_VERIFY_FAILED");
    const user = await ctx.internalAdapter.createUser({ email: identity.email, name: identity.name, emailVerified: false }, { method: "email-password" });
    if (!user) return refuse("CREATE_FAILED");
    if (!(await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: hash }))) refuse("LINK_FAILED");
    // Sealed before commit: if sealing fails, the transaction rolls back and no unreachable account remains.
    const envelope = sealCredential(input.transportKey, { email: user.email, temporary_password: password, auth_user_id: user.id });
    return { status: "created" as const, userId: user.id, envelope, audit: audit("created", user.id) };
  });
}
